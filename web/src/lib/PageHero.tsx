/**
 * A photographic strip at the top of a page.
 *
 * One component rather than three hand-rolled banners, so every page gets the
 * same height, the same scrim and the same type scale. Inconsistent hero
 * treatments across pages is the thing that makes a dashboard look assembled
 * rather than designed.
 *
 * The scrim is not optional. These are dark photographs with bright patches -
 * a sky, a floodlight - and white type over an unscrimmed photo is legible
 * only where the photo happens to cooperate.
 */

export default function PageHero({
  image,
  eyebrow,
  title,
  children,
}: {
  image: string;
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-xl bg-cover bg-center shadow-sm"
      style={{ backgroundImage: `url(${image})` }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-[#0f2942]/92 via-[#0f2942]/72 to-[#0f2942]/35" />
      <div className="relative px-5 py-4">
        <p className="text-[10px] font-medium tracking-[0.18em] text-sky-200/80 uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-white">
          {title}
        </h1>
        {children && (
          <p className="mt-1 max-w-2xl text-[12.5px] leading-snug text-sky-100/80">
            {children}
          </p>
        )}
      </div>
    </section>
  );
}
