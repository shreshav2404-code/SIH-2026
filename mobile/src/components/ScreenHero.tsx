/**
 * A photographic strip at the top of a screen.
 *
 * One component rather than a banner hand-rolled per screen, so the height,
 * scrim and type scale match everywhere. Inconsistent headers are what make an
 * app look assembled rather than designed, and this one is judged on a
 * projector by people who have seen forty others that afternoon.
 *
 * The scrim is not optional: these photographs have bright patches - a sky, a
 * floodlight - and white text over an unscrimmed photo is readable only where
 * the photo happens to cooperate.
 */

import { Image, StyleSheet, Text, View } from "react-native";

export default function ScreenHero({
  photo,
  title,
  subtitle,
  height = 96,
}: {
  photo: string;
  title: string;
  subtitle?: string;
  height?: number;
}) {
  return (
    <View style={[s.wrap, { height }]}>
      <Image source={{ uri: photo }} style={[s.img, { height }]} />
      <View style={s.scrim} />
      <View style={s.text}>
        <Text style={s.title}>{title}</Text>
        {subtitle && <Text style={s.sub}>{subtitle}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { overflow: "hidden", justifyContent: "flex-end" },
  img: { width: "100%" },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(15,41,66,0.58)",
  },
  text: { position: "absolute", left: 14, right: 14, bottom: 10 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sub: { color: "#cfe3f7", fontSize: 11, marginTop: 2 },
});
