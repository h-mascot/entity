// fs_guard — kernel-conditional, descriptor-anchored guarded mutations for the
// managed-storage broker build transaction (REC-010, run
// entity-deploy-reconciliation-20260824).
//
// Security boundary: the Node build script cannot express a mutation whose
// effect is conditional on the current identity of the mutated entry, so a
// "verify then unconditional renameSync/rmSync" sequence left an interval in
// which an external actor could replace the final path (or its parent
// directory) and have the unexpected entry destroyed. This helper closes that
// interval with kernel-mediated primitives, all relative to a verified parent
// directory descriptor:
//
//   exchange     renameatx_np(RENAME_SWAP) on macOS / renameat2(RENAME_EXCHANGE)
//                on Linux: an atomic kernel exchange that NEVER overwrites or
//                removes either side. Both entries survive, exchanged. A lost
//                race is detected by post-verification and undone by swapping
//                back, restoring any unexpected entry byte-identically in
//                place, before failing closed.
//   link-absent  linkat(dirfd, src, dirfd, dst, 0): kernel no-replace creation;
//                EEXIST fails closed if anything occupies the destination.
//   remove-owned move the entry to a fresh unpredictable tomb name with the
//                kernel no-replace conditional rename (RENAME_EXCL on macOS —
//                note macOS has no RENAME_NOREPLACE; its 0x1 flag is the
//                unrelated RENAME_SECLUDE — and RENAME_NOREPLACE on Linux),
//                so a foreign entry can only be relocated, never destroyed;
//                it is moved back on verification mismatch. The tomb is
//                unlinked only after a FRESH name-to-inode re-verification
//                immediately adjacent to the unlink (no hookable point
//                between that match and the syscall), and the unlink is
//                audited via the pinned descriptor: precisely that inode
//                must lose its link and the tomb name must be gone. A
//                replacement injected anywhere in the earlier
//                post-verify/pre-delete interval is caught by the fresh
//                re-verification and restored byte-identically — never
//                unlinked; the earlier check and the tomb name's entropy
//                never authorize the deletion.
//   selftest     prove SWAP/NOREPLACE/linkat work on the target volume before
//                the transaction relies on them; missing primitives fail the
//                build closed (there is NO unsafe fallback anywhere). The
//                selftest's own scratch cleanup is ownership-preserving and
//                fully checked: every cleanup unlink runs only while the
//                scratch name still anchors exactly the inode the selftest
//                created there, and the first refusal (replacement, foreign
//                entry, or failed unlink) preserves the entry in place and
//                fails the selftest/build closed.
//
// Every operation first anchors the parent directory: it opens the directory,
// fstats it, and requires {dev, ino} to equal the identity the build pinned at
// start-up, so a swapped parent directory can never redirect a mutation. All
// entry classification uses AT_SYMLINK_NOFOLLOW and openat(O_NOFOLLOW); only
// regular files are ever accepted, and only exact {dev, ino} matches count.
//
// Test-only hook: ENTITY_BROKER_GUARD_INNER_SWAP=<token> makes the matching
// invocation (each op receives --token from the build script) emulate an
// attacker EXACTLY between the final ownership precheck and the mutation
// syscall: it creates a canary (O_CREAT|O_EXCL) and destructively renames it
// over the guarded entry, as a real racing attacker would. The build must
// still fail closed with the canary byte-identical and nothing unexpected
// removed. ENTITY_BROKER_GUARD_PRE_DELETE_SWAP=<token> is the remove-owned
// sibling that fires between the tomb's ownership verification and the
// tomb's deletion. Neither hook ever fires in production. Both hooks' own
// canary staging is checked end-to-end (write and close) and their failure
// cleanup is ownership-preserving: a canary this helper could not fully
// stage or move is removed only while it still anchors the inode staged
// here, and a replacement of the canary itself is preserved untouched.
// Test-only fault selectors (REC-010 generation 28):
// ENTITY_BROKER_GUARD_HOOK_FAULT=<mode> (write|close|rename|rename-replace)
// makes the inner-swap canary's staging fail deterministically at its exact
// decision point; ENTITY_BROKER_GUARD_SELFTEST_FAULT=<token>:<mode>
// (replace-entry|unlink-fail) injects a replaced scratch entry or a failing
// cleanup unlink into the selftest. Neither selector ever fires in
// production.
//
// Compile: cc -std=c11 -D_GNU_SOURCE -Wall -Wextra -Werror -pedantic
// Supported hosts: macOS (10.12+) and Linux (3.15+); anything else fails at
// compile time rather than degrading to unsafe primitives.

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#if defined(__APPLE__)
// macOS <sys/stdio.h>: 0x1 is RENAME_SECLUDE (NOT no-replace). The no-replace
// conditional rename on macOS is RENAME_EXCL (fails EEXIST when the target
// name exists); the atomic exchange is RENAME_SWAP.
#define GUARD_NOREPLACE 0x00000004u // RENAME_EXCL
#define GUARD_SWAP 0x00000002u      // RENAME_SWAP
// Declared in <sys/stdio.h> since macOS 10.12; re-declared here (identical
// prototype) because strict -std=c11 hides the header declaration.
int renameatx_np(int fromfd, const char *from, int tofd, const char *to, unsigned int flags);
#elif defined(__linux__)
#include <sys/syscall.h>
#define GUARD_NOREPLACE 0x00000001u // RENAME_NOREPLACE
#define GUARD_SWAP 0x00000002u      // RENAME_EXCHANGE
#ifndef SYS_renameat2
#error this Linux toolchain does not expose the renameat2 syscall number
#endif
static int renameatx_np(int fromfd, const char *from, int tofd, const char *to, unsigned int flags) {
  return (int)syscall(SYS_renameat2, fromfd, from, tofd, to, flags);
}
#else
#error unsupported host: need renameatx_np (macOS) or renameat2 (Linux)
#endif

struct file_id {
  uint64_t dev;
  uint64_t ino;
};

struct options {
  const char *token;      // guarded-mutation token for the inner-swap hook
  const char *hook_side;  // exchange only: which side the hook replaces (a|b)
};

static int hook_fired = 0;
static int pre_delete_hook_fired = 0;
static int selftest_fault_fired = 0;

// Ownership-preserving conditional unlink (the committed generation 26
// pattern): remove `name` only while it still anchors exactly the {dev, ino}
// the caller pinned when it created the entry — an ownership check, never
// name entropy. Returns 0 when the name is gone (removed here, or already
// absent); -1 when the entry must be preserved (a replacement, a foreign
// entry, an unexpected type, or a failed unlink) so the caller fails closed
// with the entry left in place.
static int unlink_if_still_owned(int dirfd, const char *name, uint64_t dev, uint64_t ino) {
  struct stat st;
  if (fstatat(dirfd, name, &st, AT_SYMLINK_NOFOLLOW) != 0) {
    return errno == ENOENT ? 0 : -1;
  }
  if (!S_ISREG(st.st_mode)) return -1;
  if ((uint64_t)st.st_dev != dev || (uint64_t)st.st_ino != ino) return -1;
  return unlinkat(dirfd, name, 0) == 0 ? 0 : -1;
}

// 16 bytes of OS entropy for helper-internal names (tomb, inner-swap canary,
// selftest scratch). /dev/urandom is the portable source on both supported
// hosts; failing to obtain entropy fails the operation closed rather than
// degrading to a predictable name.
static int fill_random_hex(char *out, size_t hex_chars) {
  unsigned char raw[16];
  size_t need = hex_chars / 2;
  if (need > sizeof(raw)) return -1;
  int fd = open("/dev/urandom", O_RDONLY);
  if (fd < 0) return -1;
  ssize_t got = read(fd, raw, need);
  close(fd);
  if (got != (ssize_t)need) return -1;
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < need; i += 1) {
    out[i * 2] = hex[raw[i] >> 4];
    out[i * 2 + 1] = hex[raw[i] & 0x0f];
  }
  out[need * 2] = '\0';
  return 0;
}

// Minimal JSON string escaper (names/tokens are ASCII nonce identifiers; the
// escaper guarantees the emitted line stays a single JSON object regardless).
static void json_string(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)s; *p != '\0'; p += 1) {
    if (*p == '"' || *p == '\\') {
      printf("\\%c", *p);
    } else if (*p < 0x20) {
      printf("\\u%04x", *p);
    } else {
      putchar(*p);
    }
  }
  putchar('"');
}

// All results are one JSON line on stdout. ok => exit 0; guarded refusal =>
// exit 1 (JSON still printed); usage/internal errors => exit 2 (stderr).
static void print_result(int ok, const char *op, const char *reason, int recovered,
                         const char *canary, const char *tomb, const char *detail) {
  printf("{\"ok\":%s,\"op\":", ok ? "true" : "false");
  json_string(op);
  printf(",\"reason\":");
  json_string(reason == NULL ? "" : reason);
  printf(",\"recovered\":%s", recovered ? "true" : "false");
  printf(",\"canary\":");
  if (canary == NULL) {
    printf("null");
  } else {
    json_string(canary);
  }
  printf(",\"tomb\":");
  if (tomb == NULL) {
    printf("null");
  } else {
    json_string(tomb);
  }
  printf(",\"detail\":");
  json_string(detail == NULL ? "" : detail);
  printf("}\n");
}

static int parse_u64(const char *s, uint64_t *out) {
  if (s == NULL || *s == '\0') return -1;
  errno = 0;
  char *end = NULL;
  uintmax_t v = strtoumax(s, &end, 10);
  if (errno != 0 || end == s || *end != '\0' || v > UINT64_MAX) return -1;
  *out = (uint64_t)v;
  return 0;
}

// Guarded entries must be plain names inside the anchored directory: a '/'
// or "." / ".." would escape the dirfd anchor (openat with an absolute path
// ignores dirfd entirely).
static int valid_entry_name(const char *name) {
  if (name == NULL || name[0] == '\0') return 0;
  if (strchr(name, '/') != NULL) return 0;
  if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) return 0;
  return 1;
}

static void fail(const char *op, const char *reason, int recovered, const char *canary,
                 const char *tomb, const char *detail) {
  print_result(0, op, reason, recovered, canary, tomb, detail);
}

static int anchor_directory(const char *dir, uint64_t dev, uint64_t ino, int *dirfd_out) {
  int dfd = open(dir, O_RDONLY | O_DIRECTORY);
  if (dfd < 0) {
    fail("anchor", "directory-open", 0, NULL, NULL, strerror(errno));
    return -1;
  }
  struct stat st;
  if (fstat(dfd, &st) != 0 || !S_ISDIR(st.st_mode) ||
      (uint64_t)st.st_dev != dev || (uint64_t)st.st_ino != ino) {
    close(dfd);
    fail("anchor", "directory-identity", 0, NULL, NULL,
         "the directory path no longer anchors the identity the build pinned");
    return -1;
  }
  *dirfd_out = dfd;
  return 0;
}

// Classify an entry through the dirfd (NOFOLLOW: a symlink is never a file),
// then pin the exact inode through an O_NOFOLLOW descriptor. The descriptor
// stays open so the inode cannot be recycled underneath the caller.
static int anchor_entry(int dirfd, const char *name, struct file_id expected, int *fd_out,
                        const char **reason) {
  struct stat st;
  if (fstatat(dirfd, name, &st, AT_SYMLINK_NOFOLLOW) != 0) {
    *reason = errno == ENOENT ? "absent" : "stat-failed";
    return -1;
  }
  if (S_ISLNK(st.st_mode) || !S_ISREG(st.st_mode)) {
    *reason = "not-regular";
    return -1;
  }
  int fd = openat(dirfd, name, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    *reason = errno == ELOOP ? "not-regular" : "open-failed";
    return -1;
  }
  struct stat pinned;
  if (fstat(fd, &pinned) != 0 || !S_ISREG(pinned.st_mode) ||
      (uint64_t)pinned.st_dev != (uint64_t)st.st_dev || (uint64_t)pinned.st_ino != (uint64_t)st.st_ino) {
    close(fd);
    *reason = "identity-drift";
    return -1;
  }
  if ((uint64_t)pinned.st_dev != expected.dev || (uint64_t)pinned.st_ino != expected.ino) {
    close(fd);
    *reason = "identity";
    return -1;
  }
  *fd_out = fd;
  return 0;
}

static int entry_matches(int dirfd, const char *name, struct file_id expected) {
  struct stat st;
  if (fstatat(dirfd, name, &st, AT_SYMLINK_NOFOLLOW) != 0) return 0;
  if (S_ISLNK(st.st_mode) || !S_ISREG(st.st_mode)) return 0;
  return (uint64_t)st.st_dev == expected.dev && (uint64_t)st.st_ino == expected.ino;
}

// Test-only post-verify/pre-delete hook (see header comment): fire at most
// once, exactly between remove-owned's tomb verification and the tomb's
// deletion, by destructively renaming an exclusive-create canary over the
// verified tomb — a faithful emulation of the racing external attacker. The
// removal must then fail closed with the canary restored byte-identically
// and nothing deleted. Returns 0 when no injection was requested or the
// injection was performed; -1 when the requested injection could not be
// performed, so the caller fails closed instead of deleting unguarded by a
// hook the test environment demanded. The canary's own cleanup is
// checked: the cleanup unlink runs only while the canary name still anchors exactly
// the inode this helper just created (an ownership check, never name
// entropy), and any write/close/rename failure refuses the injection.
static int maybe_pre_delete_swap(int dirfd, const struct options *opt, const char *tomb) {
  const char *want = getenv("ENTITY_BROKER_GUARD_PRE_DELETE_SWAP");
  if (want == NULL || *want == '\0' || opt->token == NULL || pre_delete_hook_fired != 0) return 0;
  if (strcmp(want, opt->token) != 0) return 0;
  pre_delete_hook_fired = 1;
  char entropy[33];
  if (fill_random_hex(entropy, sizeof(entropy) - 1) != 0) return -1;
  char canary[176];
  snprintf(canary, sizeof(canary), ".guard-predelete-canary-%ld-%s", (long)getpid(), entropy);
  int fd = openat(dirfd, canary, O_CREAT | O_EXCL | O_WRONLY, 0600);
  if (fd < 0) return -1;
  struct stat created;
  if (fstat(fd, &created) != 0) {
    close(fd);
    return -1;
  }
  int written = dprintf(fd, "pre-delete-canary-%s\n", opt->token);
  int closed = close(fd);
  int moved = (written > 0 && closed == 0) ? renameat(dirfd, canary, dirfd, tomb) : -1;
  if (moved == 0) return 0;
  // The injection could not run: remove the leftover only while it still
  // anchors exactly the inode this helper created microseconds ago, then
  // refuse so the caller never deletes unguarded.
  (void)unlink_if_still_owned(dirfd, canary, (uint64_t)created.st_dev, (uint64_t)created.st_ino);
  return -1;
}

// Test-only inner-interval hook (see header comment): fire at most once, at
// the exact point between the caller's final ownership precheck and the
// mutation syscall, by destructively renaming an exclusive-create canary over
// the guarded entry — a faithful emulation of the racing external attacker.
// The canary's staging is checked end-to-end (write AND close), and a move
// that could not run is cleaned up ownership-preservingly: the canary is
// unlinked only while its name still anchors exactly the inode staged here,
// so a replacement of the canary itself is preserved untouched while the
// caller still fails closed (Luna generation 28, finding 3).
// ENTITY_BROKER_GUARD_HOOK_FAULT=<mode> (write | close | rename |
// rename-replace) is a test-only selector making the named staging step fail
// deterministically at its exact decision point; rename-replace additionally
// emulates an attacker replacing the staged canary at its own unpredictable
// name while the move fails. Returns 0 when no injection was requested or
// the injection was performed; -1 when the requested injection could not be
// performed (entropy or create failure) so the caller fails closed instead
// of mutating unguarded by a hook the test environment demanded.
static int maybe_inner_swap(int dirfd, const struct options *opt, const char *target_name) {
  const char *want = getenv("ENTITY_BROKER_GUARD_INNER_SWAP");
  if (want == NULL || *want == '\0' || opt->token == NULL || hook_fired != 0) return 0;
  if (strcmp(want, opt->token) != 0) return 0;
  hook_fired = 1;
  char entropy[33];
  if (fill_random_hex(entropy, sizeof(entropy) - 1) != 0) return -1;
  char canary[160];
  snprintf(canary, sizeof(canary), ".guard-inner-canary-%ld-%s", (long)getpid(), entropy);
  int fd = openat(dirfd, canary, O_CREAT | O_EXCL | O_WRONLY, 0600);
  if (fd < 0) return -1;
  struct stat created;
  if (fstat(fd, &created) != 0) {
    close(fd);
    return -1;
  }
  const char *fault = getenv("ENTITY_BROKER_GUARD_HOOK_FAULT");
  int written = dprintf(fd, "inner-canary-%s\n", opt->token);
  if (fault != NULL && strcmp(fault, "write") == 0) written = -1;
  int closed = close(fd);
  if (fault != NULL && strcmp(fault, "close") == 0) closed = -1;
  int fail_move = fault != NULL && strncmp(fault, "rename", 6) == 0;
  int replace_staged = fault != NULL && strcmp(fault, "rename-replace") == 0;
  int moved = -1;
  if (written > 0 && closed == 0) {
    if (!fail_move) {
      moved = renameat(dirfd, canary, dirfd, target_name) == 0 ? 0 : -1;
    } else if (replace_staged) {
      // Emulate the attacker replacing the STAGED canary at its own name in
      // the interval while the move is failing: the ownership-preserving
      // cleanup below must then refuse to unlink the replacement.
      char attacker_entropy[33];
      if (fill_random_hex(attacker_entropy, sizeof(attacker_entropy) - 1) != 0) {
        // Cannot emulate: fall through to the plain failed-move cleanup.
      } else {
        char attacker[176];
        snprintf(attacker, sizeof(attacker), ".guard-inner-attacker-%ld-%s", (long)getpid(), attacker_entropy);
        int afd = openat(dirfd, attacker, O_CREAT | O_EXCL | O_WRONLY, 0600);
        if (afd < 0) {
          // fall through to the plain failed-move cleanup
        } else {
          struct stat attacker_created;
          if (fstat(afd, &attacker_created) != 0) {
            close(afd);
          } else {
            int aw = dprintf(afd, "attacker-replacement\n");
            int ac = close(afd);
            if (aw > 0 && ac == 0 && renameat(dirfd, attacker, dirfd, canary) == 0) {
              // The canary name now anchors the attacker's inode: the cleanup
              // below must detect the mismatch and preserve it.
            } else {
              (void)unlink_if_still_owned(dirfd, attacker, (uint64_t)attacker_created.st_dev,
                                         (uint64_t)attacker_created.st_ino);
            }
          }
        }
      }
    }
  }
  if (moved == 0) return 0;
  // The attacker-style replacement could not run (or was not requested):
  // clean up this helper's canary ONLY while the name still anchors exactly
  // the inode this helper staged microseconds ago — a replacement of the
  // canary is preserved in place and the caller fails closed regardless.
  (void)unlink_if_still_owned(dirfd, canary, (uint64_t)created.st_dev, (uint64_t)created.st_ino);
  return -1;
}

static int op_exchange(const char *dir, uint64_t ddev, uint64_t dino, const char *name_a,
                       struct file_id a, const char *name_b, struct file_id b,
                       const struct options *opt) {
  const char *op = "exchange";
  int dirfd;
  if (anchor_directory(dir, ddev, dino, &dirfd) != 0) return 1;
  const char *reason = NULL;
  int fd_a = -1;
  int fd_b = -1;
  if (anchor_entry(dirfd, name_a, a, &fd_a, &reason) != 0) {
    close(dirfd);
    fail(op, reason == NULL ? "entry-a" : reason, 0, NULL, NULL, name_a);
    return 1;
  }
  if (anchor_entry(dirfd, name_b, b, &fd_b, &reason) != 0) {
    close(fd_a);
    close(dirfd);
    fail(op, reason == NULL ? "entry-b" : reason, 0, NULL, NULL, name_b);
    return 1;
  }
  close(fd_a);
  close(fd_b);
  const char *hook_target = (opt->hook_side != NULL && strcmp(opt->hook_side, "a") == 0) ? name_a : name_b;
  if (maybe_inner_swap(dirfd, opt, hook_target) != 0) {
    close(dirfd);
    fail(op, "hook-entropy", 0, NULL, NULL,
         "the requested inner-swap injection could not be performed — refusing to mutate unguarded");
    return 1;
  }
  // Snapshot what each entry anchors at the exact pre-mutation instant (the
  // hook above may legitimately have changed one side): recovery verifies
  // against THIS state, so a reversed exchange provably restores it.
  struct stat pre_a;
  struct stat pre_b;
  if (fstatat(dirfd, name_a, &pre_a, AT_SYMLINK_NOFOLLOW) != 0 ||
      fstatat(dirfd, name_b, &pre_b, AT_SYMLINK_NOFOLLOW) != 0) {
    int e = errno;
    close(dirfd);
    char detail[256];
    snprintf(detail, sizeof(detail), "pre-swap stat failed: %s", strerror(e));
    fail(op, "pre-swap-stat", 0, NULL, NULL, detail);
    return 1;
  }
  if (renameatx_np(dirfd, name_a, dirfd, name_b, GUARD_SWAP) != 0) {
    int e = errno;
    close(dirfd);
    char detail[256];
    snprintf(detail, sizeof(detail), "RENAME_SWAP failed: %s", strerror(e));
    fail(op, "swap-syscall", 0, NULL, NULL, detail);
    return 1;
  }
  // Post-verify: A must now anchor the former B identity and vice versa.
  if (entry_matches(dirfd, name_a, b) && entry_matches(dirfd, name_b, a)) {
    close(dirfd);
    print_result(1, op, "", 0, NULL, NULL, "");
    return 0;
  }
  // An unexpected entry was exchanged away (never destroyed): swap back so it
  // is restored byte-identically at its original path, then fail closed.
  // "Recovered" means the entries anchor exactly what they anchored at the
  // pre-mutation instant — including an attacker-placed entry.
  struct file_id pre_a_id = {(uint64_t)pre_a.st_dev, (uint64_t)pre_a.st_ino};
  struct file_id pre_b_id = {(uint64_t)pre_b.st_dev, (uint64_t)pre_b.st_ino};
  int recovered = 0;
  if (renameatx_np(dirfd, name_a, dirfd, name_b, GUARD_SWAP) == 0 &&
      entry_matches(dirfd, name_a, pre_a_id) && entry_matches(dirfd, name_b, pre_b_id)) {
    recovered = 1;
  }
  close(dirfd);
  fail(op, "identity-drift", recovered, NULL, NULL,
       "the guarded entry changed between the ownership check and the exchange; "
       "the exchange was reversed and every entry restored in place");
  return 1;
}

static int op_link_absent(const char *dir, uint64_t ddev, uint64_t dino, const char *src,
                          struct file_id src_id, const char *dst, const struct options *opt) {
  const char *op = "link-absent";
  int dirfd;
  if (anchor_directory(dir, ddev, dino, &dirfd) != 0) return 1;
  const char *reason = NULL;
  int fd_src = -1;
  if (anchor_entry(dirfd, src, src_id, &fd_src, &reason) != 0) {
    close(dirfd);
    fail(op, reason == NULL ? "src" : reason, 0, NULL, NULL, src);
    return 1;
  }
  close(fd_src);
  struct stat st;
  if (fstatat(dirfd, dst, &st, AT_SYMLINK_NOFOLLOW) == 0) {
    close(dirfd);
    fail(op, "dst-exists", 0, NULL, NULL, dst);
    return 1;
  }
  if (errno != ENOENT) {
    int e = errno;
    close(dirfd);
    char detail[256];
    snprintf(detail, sizeof(detail), "stat dst failed: %s", strerror(e));
    fail(op, "dst-stat", 0, NULL, NULL, detail);
    return 1;
  }
  if (maybe_inner_swap(dirfd, opt, dst) != 0) {
    close(dirfd);
    fail(op, "hook-entropy", 0, NULL, NULL,
         "the requested inner-swap injection could not be performed — refusing to mutate unguarded");
    return 1;
  }
  if (linkat(dirfd, src, dirfd, dst, 0) != 0) {
    int e = errno;
    close(dirfd);
    const char *r = e == EEXIST ? "dst-appeared" : "link-syscall";
    char detail[256];
    snprintf(detail, sizeof(detail), "linkat failed: %s", strerror(e));
    fail(op, r, 0, NULL, NULL, detail);
    return 1;
  }
  int ok = entry_matches(dirfd, dst, src_id);
  close(dirfd);
  if (!ok) {
    fail(op, "post-verify", 0, NULL, NULL, dst);
    return 1;
  }
  print_result(1, op, "", 0, NULL, NULL, "");
  return 0;
}

// Shared refusal path once the tomb no longer anchors the expected inode:
// restore the relocated entry to its original name through the kernel
// no-replace rename or, if that name is occupied, preserve the entry
// untouched at the tomb path reported in the result. Nothing is ever
// deleted on this path and success is never claimed. Closes dirfd and fd.
static int restore_or_preserve(int dirfd, int fd, const char *name, const char *tomb) {
  const char *op = "remove-owned";
  if (renameatx_np(dirfd, tomb, dirfd, name, GUARD_NOREPLACE) == 0) {
    close(fd);
    close(dirfd);
    fail(op, "replaced-and-restored", 1, NULL, NULL,
         "the removed path had been replaced; the replacement was restored in place");
    return 1;
  }
  int e = errno;
  close(fd);
  close(dirfd);
  char detail[320];
  // EEXIST: a new entry appeared at the original name; the replacement is
  // preserved untouched at the tomb path reported here. Nothing is deleted.
  snprintf(detail, sizeof(detail), "replacement preserved at tomb entry %s (%s)", tomb, strerror(e));
  fail(op, "replaced-not-restorable", 0, NULL, tomb, detail);
  return 1;
}

static int op_remove_owned(const char *dir, uint64_t ddev, uint64_t dino, const char *name,
                           struct file_id expected, const struct options *opt) {
  const char *op = "remove-owned";
  int dirfd;
  if (anchor_directory(dir, ddev, dino, &dirfd) != 0) return 1;
  const char *reason = NULL;
  int fd = -1;
  if (anchor_entry(dirfd, name, expected, &fd, &reason) != 0) {
    close(dirfd);
    fail(op, reason == NULL ? "entry" : reason, 0, NULL, NULL, name);
    return 1;
  }
  struct stat pinned;
  if (fstat(fd, &pinned) != 0) { // unreachable: anchor_entry just fstat'ed it
    close(fd);
    close(dirfd);
    fail(op, "pin-fstat", 0, NULL, NULL, name);
    return 1;
  }
  nlink_t nlink_before = pinned.st_nlink;
  // The tomb is a cryptographically unpredictable name that is NOT
  // pre-created: the kernel no-replace conditional rename (RENAME_EXCL on
  // macOS / RENAME_NOREPLACE on Linux) refuses to move onto any existing
  // entry, so even an omniscient pre-creation at the tomb name can only fail
  // the operation, never destroy anything. The move relocates the entry at
  // `name` without overwriting any other entry.
  char entropy[33];
  if (fill_random_hex(entropy, sizeof(entropy) - 1) != 0) {
    close(fd);
    close(dirfd);
    fail(op, "entropy", 0, NULL, NULL, "could not obtain OS entropy for the tomb name");
    return 1;
  }
  char tomb[160];
  snprintf(tomb, sizeof(tomb), ".guard-tomb-%ld-%s", (long)getpid(), entropy);
  if (maybe_inner_swap(dirfd, opt, name) != 0) {
    close(fd);
    close(dirfd);
    fail(op, "hook-entropy", 0, NULL, NULL,
         "the requested inner-swap injection could not be performed — refusing to mutate unguarded");
    return 1;
  }
  if (renameatx_np(dirfd, name, dirfd, tomb, GUARD_NOREPLACE) != 0) {
    int e = errno;
    close(fd);
    close(dirfd);
    char detail[256];
    const char *r = e == ENOENT ? "vanished" : (e == EEXIST ? "tomb-occupied" : "move-syscall");
    snprintf(detail, sizeof(detail), "kernel no-replace move failed: %s", strerror(e));
    fail(op, r, 0, NULL, tomb, detail);
    return 1;
  }
  if (!entry_matches(dirfd, tomb, expected)) {
    // The moved entry is NOT the one we owned: it was replaced inside the
    // guarded interval and must be restored byte-identically — never deleted.
    return restore_or_preserve(dirfd, fd, name, tomb);
  }
  // Test-only injection point: an attacker replaces the VERIFIED tomb entry
  // exactly here, in the post-verify/pre-delete interval.
  if (maybe_pre_delete_swap(dirfd, opt, tomb) != 0) {
    close(fd);
    close(dirfd);
    fail(op, "hook-entropy", 0, NULL, NULL,
         "the requested pre-delete injection could not be performed — refusing to delete unguarded");
    return 1;
  }
  // Fresh re-verification immediately adjacent to the unlink: the deletion
  // is authorized by THIS kernel identity match — the name must still anchor
  // exactly the expected inode — never by the earlier verification, the
  // tomb name's entropy, or link-count arithmetic. Any replacement injected
  // into the earlier interval is caught here and restored byte-identically;
  // the unlink below is reached only while the verified match still holds,
  // with no hookable point between the match and the syscall.
  if (!entry_matches(dirfd, tomb, expected)) {
    return restore_or_preserve(dirfd, fd, name, tomb);
  }
  // The tomb anchors exactly the pinned inode: unlink it and prove via the
  // pinned descriptor that precisely that inode lost this link and that the
  // tomb name is gone.
  if (unlinkat(dirfd, tomb, 0) != 0) {
    int e = errno;
    close(fd);
    close(dirfd);
    char detail[256];
    snprintf(detail, sizeof(detail), "tomb unlink failed: %s", strerror(e));
    fail(op, "unlink-syscall", 0, NULL, tomb, detail);
    return 1;
  }
  struct stat after;
  struct stat gone;
  int audit_ok = fstat(fd, &after) == 0 && after.st_nlink == nlink_before - 1 &&
                 fstatat(dirfd, tomb, &gone, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT;
  close(fd);
  close(dirfd);
  if (!audit_ok) {
    fail(op, "unlink-audit", 0, NULL, tomb,
         "the unlinked entry did not match the pinned inode — the removal is reported, not hidden");
    return 1;
  }
  print_result(1, op, "", 0, NULL, NULL, "");
  return 0;
}

// Test-only selftest hook (see header comment): fire at most once, between
// the scratch entries' creation and the ownership-preserving cleanup, in one
// of two deterministic modes selected by ENTITY_BROKER_GUARD_SELFTEST_FAULT=
// <token>:<mode>. "replace-entry" destructively renames an exclusive-create
// canary over the scratch entry "d" — a faithful emulation of a racing
// external actor replacing a scratch entry before cleanup. "unlink-fail"
// strips the scratch directory's write permission so the cleanup unlinks
// fail. Returns 0 when nothing was requested or the injection ran; -1 when
// the requested injection could not be performed, so the selftest fails
// closed instead of cleaning up unguarded by a hook the test environment
// demanded. The injected canary's own staging is checked and cleaned up
// ownership-preservingly on failure.
static int maybe_selftest_fault(int dirfd, const struct options *opt) {
  const char *want = getenv("ENTITY_BROKER_GUARD_SELFTEST_FAULT");
  if (want == NULL || *want == '\0' || opt->token == NULL || selftest_fault_fired != 0) return 0;
  const char *colon = strchr(want, ':');
  if (colon == NULL || colon == want) return 0;
  size_t token_len = (size_t)(colon - want);
  if (strlen(opt->token) != token_len || strncmp(want, opt->token, token_len) != 0) return 0;
  const char *mode = colon + 1;
  selftest_fault_fired = 1;
  if (strcmp(mode, "unlink-fail") == 0) {
    return fchmod(dirfd, 0500) == 0 ? 0 : -1;
  }
  if (strcmp(mode, "replace-entry") != 0) return -1; // unknown mode: refuse
  char entropy[33];
  if (fill_random_hex(entropy, sizeof(entropy) - 1) != 0) return -1;
  char canary[176];
  snprintf(canary, sizeof(canary), ".guard-selftest-canary-%ld-%s", (long)getpid(), entropy);
  int fd = openat(dirfd, canary, O_CREAT | O_EXCL | O_WRONLY, 0600);
  if (fd < 0) return -1;
  struct stat created;
  if (fstat(fd, &created) != 0) {
    close(fd);
    return -1;
  }
  int written = dprintf(fd, "selftest-canary\n");
  int closed = close(fd);
  if (written <= 0 || closed != 0 || renameat(dirfd, canary, dirfd, "d") != 0) {
    // The replacement could not run: tidy the staged canary only while it
    // still anchors the inode just created, then refuse.
    (void)unlink_if_still_owned(dirfd, canary, (uint64_t)created.st_dev, (uint64_t)created.st_ino);
    return -1;
  }
  return 0;
}

static int op_selftest(const char *dir, uint64_t ddev, uint64_t dino, const struct options *opt) {
  const char *op = "selftest";
  int parent = -1;
  if (anchor_directory(dir, ddev, dino, &parent) != 0) return 1;
  char entropy[33];
  if (fill_random_hex(entropy, sizeof(entropy) - 1) != 0) {
    close(parent);
    fail(op, "entropy", 0, NULL, NULL, "could not obtain OS entropy for the scratch name");
    return 1;
  }
  char scratch[160];
  snprintf(scratch, sizeof(scratch), ".guard-selftest-%ld-%s", (long)getpid(), entropy);
  if (mkdirat(parent, scratch, 0700) != 0) {
    int e = errno;
    close(parent);
    char detail[256];
    snprintf(detail, sizeof(detail), "scratch mkdir failed: %s", strerror(e));
    fail(op, "scratch", 0, NULL, NULL, detail);
    return 1;
  }
  int dfd = openat(parent, scratch, O_RDONLY | O_DIRECTORY);
  if (dfd < 0) {
    close(parent);
    fail(op, "scratch-open", 0, NULL, NULL, scratch);
    return 1;
  }
  const char *fail_reason = NULL;
  char detail[256] = "";
  const char *a = "a";
  const char *b = "b";
  const char *c = "c";
  const char *d = "d";
  // The inode each scratch name anchors because THIS helper put it there
  // ({0,0} = no entry of ours at that name). The cleanup below unlinks a
  // name only while it still anchors exactly this identity, so a replacement
  // injected anywhere between creation and cleanup is preserved, never
  // destroyed (Luna generation 28, finding 2).
  struct file_id expect[5];
  for (int i = 0; i < 5; i += 1) {
    expect[i].dev = 0;
    expect[i].ino = 0;
  }
  do {
    int fa = openat(dfd, a, O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fa < 0) {
      fail_reason = "create";
      break;
    }
    struct stat created_a;
    if (fstat(fa, &created_a) != 0) {
      close(fa);
      fail_reason = "create-stat";
      break;
    }
    expect[0].dev = (uint64_t)created_a.st_dev;
    expect[0].ino = (uint64_t)created_a.st_ino;
    int fb = openat(dfd, b, O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fb < 0) {
      close(fa);
      fail_reason = "create";
      break;
    }
    struct stat created_b;
    if (fstat(fb, &created_b) != 0) {
      close(fa);
      close(fb);
      fail_reason = "create-stat";
      break;
    }
    expect[1].dev = (uint64_t)created_b.st_dev;
    expect[1].ino = (uint64_t)created_b.st_ino;
    if (write(fa, "A", 1) != 1 || write(fb, "B", 1) != 1) {
      close(fa);
      close(fb);
      fail_reason = "write";
      break;
    }
    close(fa);
    close(fb);
    struct stat sa;
    struct stat sb;
    if (fstatat(dfd, a, &sa, AT_SYMLINK_NOFOLLOW) != 0 || fstatat(dfd, b, &sb, AT_SYMLINK_NOFOLLOW) != 0) {
      fail_reason = "stat";
      break;
    }
    // SWAP: a must read "B" afterwards, b must read "A".
    if (renameatx_np(dfd, a, dfd, b, GUARD_SWAP) != 0) {
      snprintf(detail, sizeof(detail), "RENAME_SWAP: %s", strerror(errno));
      fail_reason = "swap-syscall";
      break;
    }
    // The exchange swapped which inode each name anchors.
    {
      struct file_id swapped = expect[0];
      expect[0] = expect[1];
      expect[1] = swapped;
    }
    fa = openat(dfd, a, O_RDONLY | O_NOFOLLOW);
    fb = openat(dfd, b, O_RDONLY | O_NOFOLLOW);
    char ca = 0;
    char cb = 0;
    if (fa < 0 || fb < 0 || read(fa, &ca, 1) != 1 || read(fb, &cb, 1) != 1) {
      if (fa >= 0) close(fa);
      if (fb >= 0) close(fb);
      fail_reason = "swap-verify";
      break;
    }
    close(fa);
    close(fb);
    if (ca != 'B' || cb != 'A') {
      fail_reason = "swap-content";
      break;
    }
    if (linkat(dfd, a, dfd, c, 0) != 0) {
      snprintf(detail, sizeof(detail), "linkat: %s", strerror(errno));
      fail_reason = "link-syscall";
      break;
    }
    expect[2] = expect[0]; // c hard-links a's current inode
    int fd_d = openat(dfd, d, O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fd_d < 0) {
      fail_reason = "create-d";
      break;
    }
    struct stat created_d;
    if (fstat(fd_d, &created_d) != 0) {
      close(fd_d);
      fail_reason = "create-d-stat";
      break;
    }
    expect[3].dev = (uint64_t)created_d.st_dev;
    expect[3].ino = (uint64_t)created_d.st_ino;
    close(fd_d);
    errno = 0;
    if (renameatx_np(dfd, c, dfd, d, GUARD_NOREPLACE) == 0 || errno != EEXIST) {
      fail_reason = "noreplace-refused";
      break;
    }
    if (renameatx_np(dfd, c, dfd, "e", GUARD_NOREPLACE) != 0) {
      snprintf(detail, sizeof(detail), "noreplace-absent: %s", strerror(errno));
      fail_reason = "noreplace-absent";
      break;
    }
    expect[4] = expect[2]; // e is c's inode under a new name
    expect[2].dev = 0;     // ... and c is gone by this helper's own move
    expect[2].ino = 0;
    struct stat sa2;
    if (fstatat(dfd, a, &sa2, AT_SYMLINK_NOFOLLOW) != 0 ||
        (uint64_t)sa2.st_dev != (uint64_t)sb.st_dev || (uint64_t)sa2.st_ino != (uint64_t)sb.st_ino) {
      fail_reason = "swap-identity";
      break;
    }
  } while (0);
  // Test-only fault hook (see header comment): fires between the scratch
  // entries' creation and the cleanup below — exactly where an external
  // actor or a failing volume interferes with the cleanup.
  int hook_failed = maybe_selftest_fault(dfd, opt) != 0 ? 1 : 0;
  // Ownership-preserving, fully checked cleanup (Luna generation 28,
  // finding 2): every scratch mutation below runs only while the name still
  // anchors exactly the inode this helper recorded for it, and the first
  // refusal stops the cleanup — an unexpected replacement is preserved in
  // place, the scratch directory is left as visible debris holding it, and
  // the selftest (and therefore the build) fails closed.
  const char *cleanup_names[5] = {a, b, c, d, "e"};
  int cleanup_refused = 0;
  char cleanup_detail[256] = "";
  for (int i = 0; i < 5 && cleanup_refused == 0; i += 1) {
    if (unlink_if_still_owned(dfd, cleanup_names[i], expect[i].dev, expect[i].ino) != 0) {
      cleanup_refused = 1;
      snprintf(cleanup_detail, sizeof(cleanup_detail),
               "scratch cleanup refused at %s — the entry was replaced, foreign, or its unlink failed; "
               "it is preserved in the scratch directory",
               cleanup_names[i]);
    }
  }
  close(dfd);
  int rmd = unlinkat(parent, scratch, AT_REMOVEDIR);
  close(parent);
  if (fail_reason != NULL) {
    fail(op, fail_reason, 0, NULL, NULL, detail);
    return 1;
  }
  if (hook_failed) {
    fail(op, "selftest-hook", 0, NULL, NULL,
         "the requested selftest fault injection could not be performed — refusing to clean up unguarded");
    return 1;
  }
  if (cleanup_refused) {
    fail(op, "cleanup-refused", 0, NULL, scratch, cleanup_detail);
    return 1;
  }
  if (rmd != 0) {
    fail(op, "scratch-cleanup", 0, NULL, NULL, scratch);
    return 1;
  }
  print_result(1, op, "", 0, NULL, NULL, "");
  return 0;
}

static int parse_options(int argc, char **argv, int first, struct options *opt) {
  opt->token = NULL;
  opt->hook_side = NULL;
  for (int i = first; i < argc; i += 1) {
    if (strcmp(argv[i], "--token") == 0 && i + 1 < argc) {
      opt->token = argv[i + 1];
      i += 1;
    } else if (strcmp(argv[i], "--hook-side") == 0 && i + 1 < argc) {
      opt->hook_side = argv[i + 1];
      i += 1;
    } else {
      return -1;
    }
  }
  if (opt->hook_side != NULL && strcmp(opt->hook_side, "a") != 0 && strcmp(opt->hook_side, "b") != 0) {
    return -1;
  }
  return 0;
}

static int usage(void) {
  fprintf(stderr,
          "usage: fs_guard exchange DIR DIRDEV DIRINO NAMEA ADEV AINO NAMEB BDEV BINO [--token T] [--hook-side a|b]\n"
          "       fs_guard link-absent DIR DIRDEV DIRINO SRC SRCDEV SRCINO DST [--token T]\n"
          "       fs_guard remove-owned DIR DIRDEV DIRINO NAME DEV INO [--token T]\n"
          "       fs_guard selftest DIR DIRDEV DIRINO [--token T]\n");
  return 2;
}

int main(int argc, char **argv) {
  if (argc < 5) return usage();
  const char *op = argv[1];
  uint64_t ddev;
  uint64_t dino;
  if (parse_u64(argv[3], &ddev) != 0 || parse_u64(argv[4], &dino) != 0) return usage();
  if (strcmp(op, "exchange") == 0 && argc >= 11) {
    struct file_id a;
    struct file_id b;
    struct options opt;
    if (!valid_entry_name(argv[5]) || !valid_entry_name(argv[8])) return usage();
    if (parse_u64(argv[6], &a.dev) != 0 || parse_u64(argv[7], &a.ino) != 0 ||
        parse_u64(argv[9], &b.dev) != 0 || parse_u64(argv[10], &b.ino) != 0) {
      return usage();
    }
    if (parse_options(argc, argv, 11, &opt) != 0) return usage();
    return op_exchange(argv[2], ddev, dino, argv[5], a, argv[8], b, &opt);
  }
  if (strcmp(op, "link-absent") == 0 && argc >= 9) {
    struct file_id src;
    struct options opt;
    if (!valid_entry_name(argv[5]) || !valid_entry_name(argv[8])) return usage();
    if (parse_u64(argv[6], &src.dev) != 0 || parse_u64(argv[7], &src.ino) != 0) return usage();
    if (parse_options(argc, argv, 9, &opt) != 0) return usage();
    return op_link_absent(argv[2], ddev, dino, argv[5], src, argv[8], &opt);
  }
  if (strcmp(op, "remove-owned") == 0 && argc >= 8) {
    struct file_id expected;
    struct options opt;
    if (!valid_entry_name(argv[5])) return usage();
    if (parse_u64(argv[6], &expected.dev) != 0 || parse_u64(argv[7], &expected.ino) != 0) {
      return usage();
    }
    if (parse_options(argc, argv, 8, &opt) != 0) return usage();
    return op_remove_owned(argv[2], ddev, dino, argv[5], expected, &opt);
  }
  if (strcmp(op, "selftest") == 0 && argc >= 5) {
    struct options opt;
    if (parse_options(argc, argv, 5, &opt) != 0) return usage();
    return op_selftest(argv[2], ddev, dino, &opt);
  }
  return usage();
}
