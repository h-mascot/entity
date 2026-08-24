#include "managed_storage_broker.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void hex_decode(const char *s, unsigned char *out) { size_t i; for (i = 0; s[i]; i += 2) sscanf(s + i, "%2hhx", out + i / 2); }
static void respond_error(int rc) { const char *name = rc == MSB_NOT_FOUND ? "not_found" : rc == MSB_EXISTS ? "exists" : rc == MSB_LIMIT ? "limit" : rc == MSB_INVALID ? "invalid" : "io"; printf("err\t%s\n", name); fflush(stdout); }

int main(int argc, char **argv) {
  msb_broker broker = {.root_fd = -1}; char *line = NULL; size_t cap = 0; int startup_rc;
  unsigned char *path = NULL, *data = NULL, *expected = NULL, *recovery_path = NULL, *out = NULL; size_t out_cap = 0;
  if (argc != 2) return 2;
  /* Bounded heap allocation up front (never on the stack): `data` doubles as the
   * read buffer (up to MSB_MAX_READ) and the write/replace payload buffer (capped
   * at MSB_MAX_IO, which is strictly smaller). `out` holds the largest possible
   * hex response (2 hex chars per byte plus "ok\tdata\t" framing and newline). */
  path = (unsigned char *)malloc(MSB_MAX_PATH + 1U);
  data = (unsigned char *)malloc(MSB_MAX_READ);
  expected = (unsigned char *)malloc(MSB_MAX_IO);
  recovery_path = (unsigned char *)malloc(MSB_MAX_PATH + 1U);
  out_cap = MSB_MAX_READ * 2U + 64U;
  out = (unsigned char *)malloc(out_cap);
  if (!path || !data || !expected || !recovery_path || !out) { fprintf(stderr, "broker: allocation failed\n"); return 3; }
  startup_rc = msb_open(&broker, argv[1]);
  if (startup_rc != MSB_OK) { respond_error(startup_rc); goto done; }
  while (getline(&line, &cap, stdin) >= 0) {
    char *cursor = line, *op = strsep(&cursor, "\t\n"), *path_hex = strsep(&cursor, "\t\n"), *arg = strsep(&cursor, "\t\n");
    size_t path_len = path_hex ? strlen(path_hex) / 2U : 0, data_len = arg ? strlen(arg) / 2U : 0; int rc;
    if (!op || !path_hex || path_len == 0 || path_len > MSB_MAX_PATH || (arg && data_len > MSB_MAX_IO)) { respond_error(MSB_INVALID); continue; }
    hex_decode(path_hex, path); path[path_len] = '\0';
    if (!strcmp(op, "stat")) { msb_stat st; rc = msb_stat_path(&broker, (char *)path, &st); if (rc == MSB_OK) printf("ok\tstat\t%llu\t%u\t%d\n", (unsigned long long)st.size, st.mode, st.is_directory); else respond_error(rc); }
    else if (!strcmp(op, "read")) { size_t n = 0; rc = msb_read(&broker, (char *)path, data, MSB_MAX_READ, &n); if (rc == MSB_OK) { size_t i, o; const unsigned char *hexdig = (const unsigned char *)"0123456789abcdef"; memcpy(out, "ok\tdata\t", 8); o = 8; for (i = 0; i < n; ++i) { out[o++] = hexdig[data[i] >> 4]; out[o++] = hexdig[data[i] & 0x0f]; } out[o++] = '\n'; out[o] = '\0'; fwrite(out, 1, o, stdout); fflush(stdout); } else respond_error(rc); }
    else if (!strcmp(op, "write") || !strcmp(op, "create")) { if (!arg) { respond_error(MSB_INVALID); continue; } hex_decode(arg, data); rc = msb_write(&broker, (char *)path, data, data_len, !strcmp(op, "create")); if (rc == MSB_OK) { puts("ok\tempty"); fflush(stdout); } else respond_error(rc); }
    else if (!strcmp(op, "replace-if-equal")) { char *recovery_hex = arg, *expected_hex = strsep(&cursor, "\t\n"), *replacement = strsep(&cursor, "\t\n"); size_t recovery_len = recovery_hex ? strlen(recovery_hex) / 2U : 0, expected_len = expected_hex ? strlen(expected_hex) / 2U : 0, replacement_len = replacement ? strlen(replacement) / 2U : 0; if (!recovery_hex || !expected_hex || !replacement || recovery_len == 0 || recovery_len > MSB_MAX_PATH || expected_len > MSB_MAX_IO || replacement_len > MSB_MAX_IO) { respond_error(MSB_INVALID); continue; } hex_decode(recovery_hex, recovery_path); recovery_path[recovery_len] = '\0'; hex_decode(expected_hex, expected); hex_decode(replacement, data); rc = msb_replace_if_equal(&broker, (char *)path, (char *)recovery_path, expected, expected_len, data, replacement_len); if (rc == MSB_OK) { puts("ok\tempty"); fflush(stdout); } else respond_error(rc); }
    else if (!strcmp(op, "mkdir")) { char *mode = arg; char *end; long value = mode ? strtol(mode, &end, 8) : -1; rc = !mode || *end ? MSB_INVALID : msb_mkdir(&broker, (char *)path, (mode_t)value); if (rc == MSB_OK) { puts("ok\tempty"); fflush(stdout); } else respond_error(rc); }
    else if (!strcmp(op, "list")) { msb_listing list = {0}; rc = msb_list(&broker, (char *)path, &list); if (rc == MSB_OK) { size_t i; printf("ok\tdata\t"); for (i = 0; i < list.length; ++i) printf("%02x", (unsigned char)list.data[i]); puts(""); msb_free_list(&list); } else respond_error(rc); }
    else respond_error(MSB_INVALID);
    fflush(stdout);
  }
done:
  free(line); free(out); free(recovery_path); free(expected); free(data); free(path);
  msb_close(&broker); return 0;
}
