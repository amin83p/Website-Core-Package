# Core Files Contract (v1)

This document defines the internal core file/upload API used by app modules and package domains.

Primary implementation: `MVC/services/coreFilesService.js`.

## Goals

- Keep upload/file runtime behavior compatible with existing routes and payloads.
- Centralize storage-mode branching (`local` vs `railway_proxy`).
- Centralize folder/category mapping and path safety.
- Give package code a stable contract so storage architecture can change later without package rewrites.

## Contract Surface

### Upload adapter

- `getMaxUploadFileMb()`
- `resolveUploadCategory(fixedCategory, isDynamic, req)`
- `resolveUploadDestination({ fixedCategory, isDynamic, forceGlobal, req })`
- `mirrorUploadedFilesIfNeeded(req, fixedCategory)`
- `getUploadedFilePaths(req)`
- `deleteFilePaths(filePaths)`
- `deleteUploadedFiles(req)`
- `getStoredFilePath(file)`
- `getStoredFileUrl(file)`

### Common file/path helpers

- `sanitizeDrivePath(pathValue)`
- `assertValidName(name, label?)`
- `assertValidRelativePath(pathValue, label?)`
- `buildCurrentPathFromUploadBody(body)`
- `parseRelativePathsMap(body)`
- `splitFilePath(relativeToken, fallbackName)`
- `parseSourcePathInputs(body)`
- `buildPathBreadcrumbs(pathValue)`
- `resolveContextFromPath(user, requestedPath, { allowRoot })`

### File-manager operations

- `listContextDirectory(context)`
- `listFolderRowsForContext(context)`
- `transferSingleItem({ operation, sourceContext, destinationContext })`
- `deletePathByContext(context)`
- `renamePathByContext(sourceContext, newName)`
- `createFolderByContext(context, folderName)`
- `uploadFilesToContext({ context, files, relativePaths })`

## Compatibility Notes

- Existing middleware signature remains: `upload('category', isDynamic, forceGlobal)`.
- Existing `/files` route contracts remain unchanged.
- Existing `/uploads/...` public URLs remain unchanged.
- Existing folder templates/settings remain valid.

## Security Notes

- All drive/file paths are validated and normalized.
- Relative traversal and absolute-path escapes are blocked.
- Local-mode operations remain scoped under configured upload roots.
- Proxy-mode operations are delegated through authenticated gateway endpoints.
