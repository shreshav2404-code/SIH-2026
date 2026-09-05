/**
 * The ANUPALAN mark: a pit headframe, the winding tower over a mine shaft.
 *
 * Drawn with plain Views rather than SVG, deliberately. `react-native-svg` is
 * a NATIVE dependency, and adding one means a full Android Studio build -
 * which cannot be driven from this machine's agent shell (Gradle's launcher
 * can never reach its daemon here). Everything drawn from Views ships inside
 * the JS bundle instead, so the mark can be changed and re-installed in about
 * three minutes without Gradle ever running.
 *
 * It is the same geometry as the dashboard's SVG mark, so the phone and the
 * browser show one identity rather than two.
 */

import { View } from "react-native";

export default function Headframe({
  size = 26,
  color = "#7cc4fa",
}: {
  size?: number;
  color?: string;
}) {
  // Everything scales off `size` so the mark stays proportional wherever it
  // is used - a header at 26px, a splash at 96px.
  const u = size / 32;
  const stroke = Math.max(1.5, 2 * u);
  const wheel = 8 * u;

  return (
    <View style={{ width: size, height: size }}>
      {/* sheave wheel - the pulley every headframe is recognised by */}
      <View
        style={{
          position: "absolute",
          left: (size - wheel) / 2,
          top: 3 * u,
          width: wheel,
          height: wheel,
          borderRadius: wheel / 2,
          borderWidth: stroke,
          borderColor: color,
        }}
      />

      {/* the two splayed legs, drawn as rotated bars */}
      {[-1, 1].map((dir) => (
        <View
          key={dir}
          style={{
            position: "absolute",
            left: size / 2 - stroke / 2 + dir * 4 * u,
            top: 11 * u,
            width: stroke,
            height: 17 * u,
            backgroundColor: color,
            transform: [{ rotate: `${dir * 24}deg` }],
          }}
        />
      ))}

      {/* cross-bracing: what makes it read as a tower and not a letter A */}
      {[18, 22.5].map((y, i) => (
        <View
          key={y}
          style={{
            position: "absolute",
            left: (size - (7 + i * 4) * u) / 2,
            top: y * u,
            width: (7 + i * 4) * u,
            height: Math.max(1, 1.4 * u),
            backgroundColor: color,
            opacity: 0.75,
          }}
        />
      ))}

      {/* ground line */}
      <View
        style={{
          position: "absolute",
          left: 3 * u,
          top: 26 * u,
          width: 26 * u,
          height: stroke,
          borderRadius: stroke,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
