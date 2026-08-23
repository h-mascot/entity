#include "managed_storage_broker.h"
#include <assert.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static void must_(int ok, int line) { if (!ok) { fprintf(stderr, "test failed line %d: %s\n", line, strerror(errno)); abort(); } }
#define must(value) must_((value), __LINE__)
int main(void) {
  char root[] = "/tmp/msb-root-XXXXXX", outside[] = "/tmp/msb-out-XXXXXX"; char path[512];
  msb_broker b = {.root_fd = -1}; msb_stat st; msb_listing list = {0}; uint8_t buf[32]; size_t n;
  must(mkdtemp(root) != NULL); must(mkdtemp(outside) != NULL); snprintf(path, sizeof path, "%s/secret", outside); { int f = open(path, O_CREAT|O_WRONLY, 0600); must(f >= 0); must(write(f, "OUT", 3) == 3); close(f); }
  must(msb_open(&b, root) == MSB_OK);
  must(msb_write(&b, "a.txt", (const uint8_t *)"hello", 5, 1) == MSB_OK);
  must(msb_stat_path(&b, "a.txt", &st) == MSB_OK && st.size == 5 && !st.is_directory);
  must(msb_read(&b, "a.txt", buf, sizeof buf, &n) == MSB_OK && n == 5 && !memcmp(buf, "hello", 5));
  must(msb_write(&b, "a.txt", (const uint8_t *)"x", 1, 1) == MSB_EXISTS);
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
  /* A child symlink is rejected without consulting its target. */
  snprintf(path, sizeof path, "%s/link", root); must(symlink(outside, path) == 0);
  must(msb_read(&b, "link", buf, sizeof buf, &n) == MSB_INVALID);
  must(msb_write(&b, "link", (const uint8_t *)"x", 1, 1) == MSB_INVALID);
  must(msb_mkdir(&b, "link/sub", 0700) == MSB_INVALID);
  must(msb_list(&b, "link", &list) == MSB_INVALID);
  msb_close(&b);
  snprintf(path, sizeof path, "%s/link", root); unlink(path);
  snprintf(path, sizeof path, "%s/parent", root); unlink(path);
  snprintf(path, sizeof path, "%s/dir/n.txt", root); unlink(path);
  snprintf(path, sizeof path, "%s/dir", root); rmdir(path);
  snprintf(path, sizeof path, "%s/a.txt", root); unlink(path); rmdir(root);
  snprintf(path, sizeof path, "%s/secret", outside); unlink(path); rmdir(outside);
  return 0;
}
