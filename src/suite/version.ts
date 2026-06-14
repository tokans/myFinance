/** This app's installed version, read from the Tauri shell (undefined in browser dev). */
export async function currentAppVersion(): Promise<string | undefined> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return undefined;
  }
}
