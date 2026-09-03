import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { C } from "../theme";

/**
 * Keep one broken tab from taking the whole app down.
 *
 * This exists because of a failure we have already hit twice. A React Native
 * native module that is not compiled into the running binary does not fail
 * politely: react-native-litert-lm threw at MODULE LOAD and killed the app
 * before React rendered, with a red "HybridObject not registered" screen and
 * nothing to say which tab caused it.
 *
 * The same is true of expo-sensors and expo-audio, which were added after the
 * installed build was compiled. An officer with an older APK should find the
 * sensors tab explaining itself, not an app that refuses to open at all - and
 * during a demo, one dead tab is survivable where a dead app is not.
 */
interface Props {
  /** Named in the message, so the reader knows which part failed. */
  name: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class TabBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Left deliberately: on a release build the console is stripped, so the
    // on-screen message below is the only diagnostic the user gets.
    console.warn(`[${this.props.name}]`, error?.message);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const nativeMissing =
      /native module|not registered|cannot find|is not available|requireNativeComponent|turbomodule/i.test(
        error.message ?? "",
      );

    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.title}>{this.props.name} is unavailable</Text>
        <Text style={s.body}>
          {nativeMissing
            ? "This part needs a native module that is not in the installed build. " +
              "Rebuild the app to include it — the rest of the app is unaffected."
            : "Something in this tab failed. The rest of the app is unaffected."}
        </Text>
        <Text style={s.detail}>{error.message}</Text>
      </ScrollView>
    );
  }
}

const s = StyleSheet.create({
  wrap: { padding: 24, alignItems: "center" },
  title: { fontSize: 17, fontWeight: "700", color: C.ink, textAlign: "center" },
  body: {
    marginTop: 8, fontSize: 13, lineHeight: 19,
    color: C.inkSoft, textAlign: "center",
  },
  detail: {
    marginTop: 14, fontFamily: "monospace", fontSize: 11,
    color: C.crit, textAlign: "center",
  },
});
