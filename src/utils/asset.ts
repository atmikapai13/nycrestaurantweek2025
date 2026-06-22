// Prefix a public/ asset path with Vite's base URL so it resolves under the
// app's subpath (e.g. "/remi.png" -> "/spring2026/remi.png").
export const asset = (path: string): string =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
