#include "managed_storage_broker.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int valid_path(const char *path) {
  size_t n;
  const char *p;
  if (!path || path[0] == '/' || path[0] == '\0') return 0;
  n = strnlen(path, MSB_MAX_PATH + 1U);
  if (n == 0 || n > MSB_MAX_PATH || path[n] != '\0') return 0;
  p = path;
  while (*p) {
    const char *end = strchr(p, '/');
    size_t len = end ? (size_t)(end - p) : strlen(p);
    if (len == 0 || (len == 1 && p[0] == '.') || (len == 2 && p[0] == '.' && p[1] == '.')) return 0;
    p = end ? end + 1 : p + len;
  }
  return 1;
}

static int map_errno(void) {
  if (errno == ENOENT) return MSB_NOT_FOUND;
  if (errno == EEXIST) return MSB_EXISTS;
  if (errno == ELOOP || errno == ENOTDIR || errno == EINVAL || errno == EACCES) return MSB_INVALID;
  return MSB_IO;
}

static int parent_fd(const msb_broker *broker, const char *path, char *leaf) {
  char copy[MSB_MAX_PATH + 1U];
  char *cursor;
  int fd;
  if (!broker || broker->root_fd < 0 || !valid_path(path)) return MSB_INVALID;
  strcpy(copy, path);
  cursor = copy;
  fd = dup(broker->root_fd);
  if (fd < 0) return MSB_IO;
  for (;;) {
    char *slash = strchr(cursor, '/');
    if (!slash) { strcpy(leaf, cursor); return fd; }
    *slash = '\0';
    { int next = openat(fd, cursor, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW); close(fd); if (next < 0) return map_errno(); fd = next; }
    cursor = slash + 1;
  }
}

int msb_open(msb_broker *broker, const char *root) {
  if (!broker || !root) return MSB_INVALID;
  broker->root_fd = open(root, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  return broker->root_fd < 0 ? map_errno() : MSB_OK;
}
void msb_close(msb_broker *broker) { if (broker && broker->root_fd >= 0) { close(broker->root_fd); broker->root_fd = -1; } }

int msb_stat_path(const msb_broker *broker, const char *path, msb_stat *out) {
  char leaf[MSB_MAX_PATH + 1U]; struct stat st; int fd = parent_fd(broker, path, leaf); int rc;
  if (fd < 0) return fd;
  rc = fstatat(fd, leaf, &st, AT_SYMLINK_NOFOLLOW); close(fd);
  if (rc < 0) return map_errno();
  if (S_ISLNK(st.st_mode)) return MSB_INVALID;
  out->size = (uint64_t)st.st_size; out->mode = (uint32_t)st.st_mode; out->is_directory = S_ISDIR(st.st_mode);
  return MSB_OK;
}

int msb_read(const msb_broker *broker, const char *path, uint8_t *out, size_t capacity, size_t *length) {
  char leaf[MSB_MAX_PATH + 1U]; int fd = parent_fd(broker, path, leaf); ssize_t n; struct stat st;
  if (fd < 0 || !out || !length || capacity > MSB_MAX_IO) { if (fd >= 0) close(fd); return MSB_INVALID; }
  if (fstatat(fd, leaf, &st, AT_SYMLINK_NOFOLLOW) < 0) { close(fd); return map_errno(); }
  if (S_ISLNK(st.st_mode)) { close(fd); return MSB_INVALID; }
  if (!S_ISREG(st.st_mode) || st.st_size < 0 || (uint64_t)st.st_size > capacity || (uint64_t)st.st_size > MSB_MAX_IO) { close(fd); return MSB_LIMIT; }
  { int file = openat(fd, leaf, O_RDONLY | O_CLOEXEC | O_NOFOLLOW); close(fd); if (file < 0) return map_errno(); n = read(file, out, capacity); close(file); }
  if (n < 0) return map_errno(); *length = (size_t)n; return ((uint64_t)n == (uint64_t)st.st_size) ? MSB_OK : MSB_IO;
}

int msb_write(const msb_broker *broker, const char *path, const uint8_t *data, size_t length, int exclusive) {
  char leaf[MSB_MAX_PATH + 1U]; int fd = parent_fd(broker, path, leaf); int flags = O_WRONLY | O_CREAT | O_CLOEXEC | O_NOFOLLOW; int file; ssize_t n;
  if (fd < 0 || (!data && length) || length > MSB_MAX_IO) { if (fd >= 0) close(fd); return MSB_INVALID; }
  if (exclusive) flags |= O_EXCL;
  { struct stat existing; if (fstatat(fd, leaf, &existing, AT_SYMLINK_NOFOLLOW) == 0 && S_ISLNK(existing.st_mode)) { close(fd); return MSB_INVALID; } }
  file = openat(fd, leaf, flags, 0600); close(fd); if (file < 0) return map_errno();
  n = write(file, data, length); if (n >= 0 && (size_t)n == length) { if (ftruncate(file, (off_t)length) < 0) n = -1; } close(file);
  return n < 0 ? map_errno() : ((size_t)n == length ? MSB_OK : MSB_IO);
}

int msb_mkdir(const msb_broker *broker, const char *path, mode_t mode) { char leaf[MSB_MAX_PATH + 1U]; int fd = parent_fd(broker, path, leaf); int rc; if (fd < 0) return fd; rc = mkdirat(fd, leaf, mode); close(fd); return rc < 0 ? map_errno() : MSB_OK; }

int msb_list(const msb_broker *broker, const char *path, msb_listing *out) {
  char leaf[MSB_MAX_PATH + 1U]; int pfd = parent_fd(broker, path, leaf); int dfd; DIR *dir; struct dirent *entry; size_t used = 0;
  if (pfd < 0 || !out) { if (pfd >= 0) close(pfd); return MSB_INVALID; }
  dfd = openat(pfd, leaf, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW); close(pfd); if (dfd < 0) return map_errno();
  dir = fdopendir(dfd); if (!dir) { close(dfd); return MSB_IO; }
  out->data = malloc(1); if (!out->data) { closedir(dir); return MSB_IO; } out->data[0] = '\0';
  while ((entry = readdir(dir))) { size_t n; char *next; if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue; n = strlen(entry->d_name); if (used + n + 2 > MSB_MAX_IO) { msb_free_list(out); closedir(dir); return MSB_LIMIT; } next = realloc(out->data, used + n + 2); if (!next) { msb_free_list(out); closedir(dir); return MSB_IO; } out->data = next; memcpy(out->data + used, entry->d_name, n); used += n; out->data[used++] = '\n'; out->data[used] = '\0'; }
  closedir(dir); out->length = used; return MSB_OK;
}
void msb_free_list(msb_listing *list) { if (list) { free(list->data); list->data = NULL; list->length = 0; } }
int msb_protocol_validate(const uint8_t *request, size_t length) { if (!request || length < 2 || length > MSB_MAX_IO) return MSB_INVALID; return (request[0] >= '1' && request[0] <= '6' && memchr(request, '\0', length) == NULL) ? MSB_OK : MSB_INVALID; }
