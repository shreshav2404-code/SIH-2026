/**
 * Original vector artwork for ANUPALAN.
 *
 * Drawn rather than sourced. Stock photography of mines carries licence terms
 * nobody on this team has read, and a compliance tool that ships an unlicensed
 * image is a bad look in a room full of judges. Everything here is geometry,
 * so it also scales to any density and costs nothing to load.
 *
 * The mark is a pit headframe - the winding tower over a mine shaft. It reads
 * as "mine" at 16px in a browser tab and at 200px on a login screen, which a
 * more literal drawing of a pit would not.
 */

export function Headframe({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* sheave wheel - the pulley at the top of every headframe */}
      <circle cx="16" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="7" r="1.1" fill="currentColor" />
      {/* the two legs, splayed */}
      <path
        d="M16 11 L8 27 M16 11 L24 27"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* cross-bracing, which is what makes it read as a tower not an A */}
      <path
        d="M12.6 18 L19.4 18 M10.6 22.5 L21.4 22.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* ground line */}
      <path
        d="M5 27 H27"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Illustrations for empty states.
 *
 * An empty panel that says only "no data" reads as broken. These say "nothing
 * here YET" - a drawn placeholder is understood as a designed state rather
 * than a failure, which matters on a dashboard a judge sees before the
 * simulator is started.
 */

export function EmptyChart({ className = "" }: { className?: string }) {
  return (
    <svg
      width="96"
      height="60"
      viewBox="0 0 96 60"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 52 H88" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <path d="M8 8 V52" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      {/* a dashed trace, as though the line has not arrived yet */}
      <path
        d="M12 42 C24 42 26 26 36 26 C46 26 48 36 58 34 C68 32 72 18 84 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="3 4"
        strokeLinecap="round"
        opacity=".5"
      />
      <path
        d="M8 20 H88"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="4 3"
        opacity=".3"
      />
    </svg>
  );
}

export function EmptyAlerts({ className = "" }: { className?: string }) {
  return (
    <svg
      width="72"
      height="60"
      viewBox="0 0 72 60"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* a bell, quiet */}
      <path
        d="M36 12 C28 12 24 17 24 24 v8 l-4 6 h32 l-4 -6 v-8 c0 -7 -4 -12 -12 -12 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity=".55"
      />
      <path
        d="M32 44 a4 4 0 0 0 8 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".55"
      />
      <path d="M36 8 v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

export function EmptyBox({ className = "" }: { className?: string }) {
  return (
    <svg
      width="72"
      height="60"
      viewBox="0 0 72 60"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 22 L36 12 L60 22 L36 32 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity=".55"
      />
      <path
        d="M12 22 v16 L36 48 V32 M60 22 v16 L36 48"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity=".4"
      />
    </svg>
  );
}
