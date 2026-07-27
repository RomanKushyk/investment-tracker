export function ScreenHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h2 className="mb-1 text-[26px]">{title}</h2>
      <p className="mb-[22px] text-[13px] text-muted">{subtitle}</p>
    </>
  );
}
