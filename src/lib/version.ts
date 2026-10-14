/** "0.2.0" is older than "0.10.0"; anything after the third number ("-beta", "+build") is ignored. */
export function older(version: string, than: string): boolean {
  const a = version.split(/[.+-]/).slice(0, 3).map(Number);
  const b = than.split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}
