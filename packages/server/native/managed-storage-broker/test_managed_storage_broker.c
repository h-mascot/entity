#include "managed_storage_broker.h"
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

static void must_(int ok, int line) { if (!ok) { fprintf(stderr, "test failed line %d: %s\n", line, strerror(errno)); abort(); } }
#define must(value) must_((value), __LINE__)

typedef struct { int ready_fd; int release_fd; } replace_barrier;

static void pause_before_replace(void *context) {
  replace_barrier *barrier = context;
  char byte = '1';
  must(write(barrier->ready_fd, &byte, 1) == 1);
  must(read(barrier->release_fd, &byte, 1) == 1);
}

static void test_replace_holds_operation_lock(const msb_broker *broker, const char *root) {
  char recovery[512], target[512], byte;
  uint8_t *replacement = malloc(MSB_MAX_IO);
  size_t observed_length = 0;
  pid_t child, competitor;
  int child_status = 0, competitor_status = 0, entered_lock, lock_fd, ready[2], release[2], competitor_started[2];

  must(replacement != NULL);
  memset(replacement, 'x', MSB_MAX_IO);
  must(msb_write(broker, "lock.txt", (const uint8_t *)"old", 3, 1) == MSB_OK);
  must(pipe(ready) == 0 && pipe(release) == 0);

  child = fork();
  must(child >= 0);
  if (child == 0) {
    replace_barrier barrier = {.ready_fd = ready[1], .release_fd = release[0]};
    msb_broker child_broker = {.root_fd = -1, .before_replace = pause_before_replace, .before_replace_context = &barrier};
    int rc = msb_open(&child_broker, root);
    close(ready[0]); close(release[1]);
    if (rc != MSB_OK) _exit(2);
    rc = msb_replace_if_equal(&child_broker, "lock.txt", ".recovery/lock.txt",
                              (const uint8_t *)"old", 3, replacement, MSB_MAX_IO);
    msb_close(&child_broker);
    _exit(rc == MSB_OK ? 0 : 1);
  }

  close(ready[1]); close(release[0]);
  must(read(ready[0], &byte, 1) == 1);
  close(ready[0]);
  lock_fd = open(root, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  must(lock_fd >= 0);
  entered_lock = flock(lock_fd, LOCK_EX | LOCK_NB) == 0;
  if (entered_lock) must(flock(lock_fd, LOCK_UN) == 0);
  close(lock_fd);
  must(!entered_lock);

  must(pipe(competitor_started) == 0);
  competitor = fork();
  must(competitor >= 0);
  if (competitor == 0) {
    msb_broker competitor_broker = {.root_fd = -1};
    int rc = msb_open(&competitor_broker, root);
    close(competitor_started[0]); close(release[1]);
    if (rc != MSB_OK) _exit(2);
    must(write(competitor_started[1], "1", 1) == 1);
    close(competitor_started[1]);
    rc = msb_replace_if_equal(&competitor_broker, "lock.txt", ".recovery/lock.txt",
                              (const uint8_t *)"old", 3, (const uint8_t *)"competing", 9);
    msb_close(&competitor_broker);
    _exit(rc == MSB_EXISTS ? 0 : rc == MSB_OK ? 3 : 4);
  }
  close(competitor_started[1]);
  must(read(competitor_started[0], &byte, 1) == 1);
  close(competitor_started[0]);
  must(waitpid(competitor, &competitor_status, WNOHANG) == 0);
  must(write(release[1], "1", 1) == 1);
  close(release[1]);

  must(waitpid(child, &child_status, 0) == child);
  must(WIFEXITED(child_status) && WEXITSTATUS(child_status) == 0);
  must(waitpid(competitor, &competitor_status, 0) == competitor);
  must(WIFEXITED(competitor_status) && WEXITSTATUS(competitor_status) == 0);

  must(msb_read(broker, "lock.txt", replacement, MSB_MAX_IO, &observed_length) == MSB_OK);
  must(observed_length == MSB_MAX_IO && replacement[0] == 'x' && replacement[MSB_MAX_IO - 1U] == 'x');
  must(msb_read(broker, ".recovery/lock.txt", replacement, MSB_MAX_IO, &observed_length) == MSB_OK);
  must(observed_length == 3 && !memcmp(replacement, "old", 3));

  snprintf(target, sizeof target, "%s/lock.txt", root);
  unlink(target);
  snprintf(recovery, sizeof recovery, "%s/.recovery/lock.txt", root);
  unlink(recovery);
  free(replacement);
}

int main(void) {
  char root[] = "/tmp/msb-root-XXXXXX", outside[] = "/tmp/msb-out-XXXXXX"; char path[512];
  msb_broker b = {.root_fd = -1}; msb_stat st; msb_listing list = {0}; uint8_t buf[32]; size_t n;
  must(mkdtemp(root) != NULL); must(mkdtemp(outside) != NULL); snprintf(path, sizeof path, "%s/secret", outside); { int f = open(path, O_CREAT|O_WRONLY, 0600); must(f >= 0); must(write(f, "OUT", 3) == 3); close(f); }
  must(msb_open(&b, root) == MSB_OK);
  must(msb_write(&b, "a.txt", (const uint8_t *)"hello", 5, 1) == MSB_OK);
  must(msb_stat_path(&b, "a.txt", &st) == MSB_OK && st.size == 5 && !st.is_directory);
  must(msb_read(&b, "a.txt", buf, sizeof buf, &n) == MSB_OK && n == 5 && !memcmp(buf, "hello", 5));
  must(msb_write(&b, "a.txt", (const uint8_t *)"x", 1, 1) == MSB_EXISTS);
  must(msb_mkdir(&b, ".recovery", 0700) == MSB_OK);
  test_replace_holds_operation_lock(&b, root);
  must(msb_replace_if_equal(&b, "a.txt", ".recovery/a.txt", (const uint8_t *)"wrong", 5, (const uint8_t *)"new", 3) == MSB_EXISTS);
  must(msb_read(&b, "a.txt", buf, sizeof buf, &n) == MSB_OK && n == 5 && !memcmp(buf, "hello", 5));
  must(msb_stat_path(&b, ".recovery/a.txt", &st) == MSB_NOT_FOUND);
  must(msb_replace_if_equal(&b, "a.txt", ".recovery/a.txt", (const uint8_t *)"hello", 5, (const uint8_t *)"new", 3) == MSB_OK);
  must(msb_read(&b, "a.txt", buf, sizeof buf, &n) == MSB_OK && n == 3 && !memcmp(buf, "new", 3));
  must(msb_read(&b, ".recovery/a.txt", buf, sizeof buf, &n) == MSB_OK && n == 5 && !memcmp(buf, "hello", 5));
  must(msb_mkdir(&b, "dir", 0700) == MSB_OK); must(msb_write(&b, "dir/n.txt", (const uint8_t *)"n", 1, 1) == MSB_OK);
  must(msb_list(&b, "dir", &list) == MSB_OK && strstr(list.data, "n.txt\n") != NULL); msb_free_list(&list);
  must(msb_protocol_validate((const uint8_t *)"1 a.txt", 7) == MSB_OK);
  must(msb_protocol_validate((const uint8_t *)"1\0", 2) == MSB_INVALID);
  must(msb_protocol_validate((const uint8_t *)"7 x", 3) == MSB_INVALID);
  must(msb_protocol_validate((const uint8_t *)"", 0) == MSB_INVALID);
  must(msb_read(&b, "/etc/passwd", buf, sizeof buf, &n) == MSB_INVALID);
  must(msb_read(&b, "../secret", buf, sizeof buf, &n) == MSB_INVALID);
  must(msb_read(&b, "dir//n.txt", buf, sizeof buf, &n) == MSB_INVALID);
  must(msb_write(&b, "too-big", buf, MSB_MAX_IO + 1U, 1) == MSB_INVALID);
  snprintf(path, sizeof path, "%s/secret", outside);
  /* child symlink: no outside read/write/create */
  snprintf(path, sizeof path, "%s/parent", root); must(symlink(outside, path) == 0);
  must(msb_read(&b, "parent/secret", buf, sizeof buf, &n) == MSB_INVALID);
  must(msb_write(&b, "parent/new", (const uint8_t *)"x", 1, 1) == MSB_INVALID);
  must(msb_mkdir(&b, "parent/newdir", 0700) == MSB_INVALID);
  must(msb_list(&b, "parent", &list) == MSB_INVALID);
  must(msb_replace_if_equal(&b, "parent/secret", ".recovery/parent", (const uint8_t *)"OUT", 3, (const uint8_t *)"bad", 3) == MSB_INVALID);
  /* A child symlink is rejected without consulting its target. */
  snprintf(path, sizeof path, "%s/link", root); must(symlink(outside, path) == 0);
  must(msb_read(&b, "link", buf, sizeof buf, &n) == MSB_INVALID);
  must(msb_write(&b, "link", (const uint8_t *)"x", 1, 1) == MSB_INVALID);
  must(msb_mkdir(&b, "link/sub", 0700) == MSB_INVALID);
  must(msb_list(&b, "link", &list) == MSB_INVALID);
  must(msb_replace_if_equal(&b, "link", ".recovery/link-target", (const uint8_t *)"new", 3, (const uint8_t *)"bad", 3) == MSB_INVALID);
  snprintf(path, sizeof path, "%s/.recovery/link", root); must(symlink(outside, path) == 0);
  must(msb_replace_if_equal(&b, "a.txt", ".recovery/link", (const uint8_t *)"new", 3, (const uint8_t *)"bad", 3) == MSB_INVALID);
  msb_close(&b);
  snprintf(path, sizeof path, "%s/.recovery/link", root); unlink(path);
  snprintf(path, sizeof path, "%s/link", root); unlink(path);
  snprintf(path, sizeof path, "%s/parent", root); unlink(path);
  snprintf(path, sizeof path, "%s/dir/n.txt", root); unlink(path);
  snprintf(path, sizeof path, "%s/dir", root); rmdir(path);
  snprintf(path, sizeof path, "%s/.recovery/a.txt", root); unlink(path);
  snprintf(path, sizeof path, "%s/.recovery", root); rmdir(path);
  snprintf(path, sizeof path, "%s/a.txt", root); unlink(path); rmdir(root);
  snprintf(path, sizeof path, "%s/secret", outside); unlink(path); rmdir(outside);
  return 0;
}
