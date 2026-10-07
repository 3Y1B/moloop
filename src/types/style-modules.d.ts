/** Web-only style imports are bundled by Expo/Metro; TypeScript only needs their module shapes. */
declare module "*.css" {
  const classes: Record<string, string>;
  export default classes;
}
