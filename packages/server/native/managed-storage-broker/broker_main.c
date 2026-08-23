#include "managed_storage_broker.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void hex_decode(const char *s, unsigned char *out) { size_t i; for (i = 0; s[i]; i += 2) sscanf(s + i, "%2hhx", out + i / 2); }
static void respond_error(int rc) { const char *name = rc == MSB_NOT_FOUND ? "not_found" : rc == MSB_EXISTS ? "exists" : rc == MSB_LIMIT ? "limit" : rc == MSB_INVALID ? "invalid" : "io"; printf("err\t%s\n", name); fflush(stdout); }
int main(int argc, char **argv) {
  msb_broker broker = {.root_fd = -1}; char *line = NULL; size_t cap = 0; int startup_rc;
  if (argc != 2) return 2;
  startup_rc = msb_open(&broker, argv[1]);
  if (startup_rc != MSB_OK) { respond_error(startup_rc); return 0; }
  while (getline(&line, &cap, stdin) >= 0) {
    char *op = strtok(line, "\t\n"), *path_hex = strtok(NULL, "\t\n"), *arg = strtok(NULL, "\t\n");
    unsigned char path[MSB_MAX_PATH + 1U], data[MSB_MAX_IO]; size_t path_len = path_hex ? strlen(path_hex) / 2U : 0, data_len = arg ? strlen(arg) / 2U : 0; int rc;
    if (!op || !path_hex || path_len == 0 || path_len > MSB_MAX_PATH || (arg && data_len > MSB_MAX_IO)) { respond_error(MSB_INVALID); continue; }
    hex_decode(path_hex, path); path[path_len] = '\0';
    if (!strcmp(op, "stat")) { msb_stat st; rc = msb_stat_path(&broker, (char *)path, &st); if (rc == MSB_OK) printf("ok\tstat\t%llu\t%u\t%d\n", (unsigned long long)st.size, st.mode, st.is_directory); else respond_error(rc); }
    else if (!strcmp(op, "read")) { msb_stat st; rc = msb_stat_path(&broker, (char *)path, &st); if (rc == MSB_OK && st.size <= MSB_MAX_IO) { size_t n = 0; rc = msb_read(&broker, (char *)path, data, MSB_MAX_IO, &n); if (rc == MSB_OK) { size_t i; printf("ok\tdata\t"); for (i = 0; i < n; ++i) printf("%02x", data[i]); printf("\n"); fflush(stdout); } else respond_error(rc); } else respond_error(rc); }
    else if (!strcmp(op, "write") || !strcmp(op, "create")) { if (!arg) { respond_error(MSB_INVALID); continue; } hex_decode(arg, data); rc = msb_write(&broker, (char *)path, data, data_len, !strcmp(op, "create")); if (rc == MSB_OK) { puts("ok\tempty"); fflush(stdout); } else respond_error(rc); }
    else if (!strcmp(op, "mkdir")) { char *mode = arg; char *end; long value = mode ? strtol(mode, &end, 8) : -1; rc = !mode || *end ? MSB_INVALID : msb_mkdir(&broker, (char *)path, (mode_t)value); if (rc == MSB_OK) { puts("ok\tempty"); fflush(stdout); } else respond_error(rc); }
    else if (!strcmp(op, "list")) { msb_listing list = {0}; rc = msb_list(&broker, (char *)path, &list); if (rc == MSB_OK) { size_t i; printf("ok\tdata\t"); for (i = 0; i < list.length; ++i) printf("%02x", (unsigned char)list.data[i]); puts(""); fflush(stdout); msb_free_list(&list); } else respond_error(rc); }
    else respond_error(MSB_INVALID);
  }
  free(line); msb_close(&broker); return 0;
}
