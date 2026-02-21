/**
 * @module util/packageName
 * Extracts package scope and name from npm environment (process.env.npm_package_name). Regex-based parsing. No I/O, reads process.env.
 */

const npmPackageRegex =
  /^(?:(?<packageScope>@[a-z0-9-~][a-z0-9-._~]*)\/)?(?<packageName>[a-z0-9-~][a-z0-9-._~]*)$/;

export const { packageScope, packageName } =
  (process.env.npm_package_name?.match(npmPackageRegex)?.groups ?? {}) as {
    packageScope?: string;
    packageName?: string;
  };
