/** Human-readable Turkish "last seen" formatting. */
export function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "Hiç görülmedi";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Hiç görülmedi";

  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) return "az önce aktifti";
  if (mins < 60) return `${mins} dk önce aktifti`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} saat önce aktifti`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "dün aktifti";
  if (days < 7) return `${days} gün önce aktifti`;

  return `${new Date(iso).toLocaleDateString("tr-TR")} tarihinde aktifti`;
}
