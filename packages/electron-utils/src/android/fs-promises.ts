import { promises } from './fs'

export const { readFile, writeFile, appendFile, mkdir, readdir, stat, lstat, unlink, rm, rmdir, rename, copyFile, access, mkdtemp, realpath, utimes, chmod, open } = promises
export default promises
