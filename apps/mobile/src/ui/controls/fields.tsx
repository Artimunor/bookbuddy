import { useId, useState, type ComponentRef, type Ref } from "react";
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { native } from "@bookbuddy/design-tokens";
import { useBeaconTheme } from "../theme";
import { Copy, Target, controlMetrics, focusRing } from "./shared";

type InputOptions = Pick<TextInputProps,
  "autoComplete" | "autoCapitalize" | "autoCorrect" | "inputMode" | "multiline" | "maxLength" |
  "placeholder" | "returnKeyType" | "secureTextEntry" | "onSubmitEditing" | "textContentType" |
  "onFocus" | "onBlur"
>;

export type TextFieldProps = InputOptions & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  helper?: string;
  error?: string;
  readOnly?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  writingDirection?: "ltr" | "rtl";
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

export function TextField(props: TextFieldProps) {
  return <Field {...props} />;
}

export type CodeFieldProps = Omit<TextFieldProps,
  "autoComplete" | "autoCapitalize" | "autoCorrect" | "inputMode" | "multiline" | "maxLength" |
  "secureTextEntry" | "textContentType"
>;

// One real input keeps editing, pasting, and OS OTP autofill available.
export function CodeField({ onChangeText, ...props }: CodeFieldProps) {
  return <Field
    {...props}
    code
    inputMode="numeric"
    autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
    autoCorrect={false}
    autoCapitalize="none"
    onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, "").slice(0, 6))}
  />;
}

function Field({
  label, value, onChangeText, helper, error, readOnly, disabled, accessibilityLabel,
  ref, code, onFocus, onBlur, writingDirection, ...options
}: TextFieldProps & { code?: boolean }) {
  const { color, type, radius, field, space } = useBeaconTheme();
  const [focused, setFocused] = useState(false);
  const descriptionId = useId();
  const description = error || helper;
  const metrics = controlMetrics(field);
  const borderColor = error ? color.criticalInk : color.outline;
  const backgroundColor = readOnly || disabled ? color.subtle : color.surface;
  const input = (
    <TextInput
        {...options}
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        readOnly={!!readOnly || !!disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={Platform.OS === "web" ? undefined : description}
        accessibilityState={{ disabled }}
        {...(Platform.OS === "web" ? {
          "aria-describedby": description ? descriptionId : undefined,
          "aria-disabled": disabled,
          "aria-invalid": !!error,
          tabIndex: disabled ? -1 : undefined,
        } : undefined)}
        placeholderTextColor={color.muted}
        selectionColor={color.brandInk}
        caretHidden={code}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        style={[
          type.body,
          {
            color: code ? "transparent" : color.ink,
            backgroundColor: code ? "transparent" : backgroundColor,
            borderColor: code ? "transparent" : borderColor,
            borderRadius: radius.input,
            borderWidth: metrics.controlBorderWidth,
            minHeight: options.multiline ? native.ergonomics.field.rowMinHeight + space.grid[8] : metrics.rowMinHeight,
            paddingHorizontal: space.grid[4],
            paddingVertical: space.grid[3],
          },
          options.multiline && styles.multiline,
          writingDirection && { writingDirection, textAlign: writingDirection === "ltr" ? "left" : "right" },
          code && [type.sectionTitle, native.tabularNumbers, styles.code],
          focused && !code && focusRing(color.brandInk),
        ]}
      />
  );
  return (
    <View style={{ gap: space.grid[2] }}>
      <Copy variant="label">{label}</Copy>
      {code ? (
        <View style={[{
          borderRadius: radius.input, borderWidth: metrics.controlBorderWidth, borderColor, backgroundColor,
        }, focused && focusRing(color.brandInk)]}>
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            aria-hidden style={styles.cells}>
            {Array.from({ length: 6 }, (_, index) => (
              <View key={index} style={[styles.cell, index > 0 && { borderStartWidth: 1, borderColor: color.separator }]}>
                <Copy variant="sectionTitle" style={[native.tabularNumbers, {
                  color: value[index] ? color.ink : color.muted,
                }]}>{value[index] ?? "·"}</Copy>
              </View>
            ))}
          </View>
          {input}
        </View>
      ) : input}
      {!!description && (
        <Copy nativeID={descriptionId} accessibilityLiveRegion="polite" variant="supporting" style={{ color: error ? color.criticalInk : color.muted }}>
          {description}
        </Copy>
      )}
    </View>
  );
}

export type SegmentOption<Value extends string = string> = {
  value: Value;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
};

export type SegmentedControlProps<Value extends string = string> = {
  label: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
};

export function SegmentedControl<Value extends string>({ label, options, value, onChange, disabled }: SegmentedControlProps<Value>) {
  const { color, field, radius, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  return (
    <View style={{ gap: space.grid[2] }}>
      <Copy variant="label">{label}</Copy>
      <View role="group" accessibilityLabel={label} style={[styles.segments, { gap: metrics.controlGap }]}>
        {options.map((option) => {
          const selected = option.value === value;
          const unavailable = !!disabled || !!option.disabled;
          return (
            <Target
              key={option.value}
              accessibilityRole={Platform.OS === "web" ? "button" : "togglebutton"}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              accessibilityState={{ selected, checked: selected, disabled: unavailable }}
              {...(Platform.OS === "web" ? { "aria-pressed": selected } : undefined)}
              disabled={unavailable}
              onPress={() => { if (!selected) onChange(option.value); }}
              style={({ pressed }) => [styles.segment, {
                minHeight: metrics.rowMinHeight,
                borderRadius: radius.pill,
                borderColor: selected ? color.brand : color.outline,
                borderWidth: metrics.controlBorderWidth,
                backgroundColor: selected ? (pressed ? color.brandPressed : color.brand)
                  : unavailable || pressed ? color.subtle : color.surface,
                paddingHorizontal: space.grid[3],
                paddingVertical: space.grid[2],
              }]}
            >
              <Copy variant="label" style={{ color: selected ? color.onBrand : unavailable ? color.muted : color.ink, textAlign: "center" }}>
                {selected ? `✓ ${option.label}` : option.label}
              </Copy>
            </Target>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  multiline: { textAlignVertical: "top" },
  code: { letterSpacing: 6, writingDirection: "ltr", textAlign: "center" },
  cells: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, flexDirection: "row", direction: "ltr", alignItems: "center" },
  cell: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  segments: { flexDirection: "row", flexWrap: "wrap" },
  segment: { flexGrow: 1, maxWidth: "100%", justifyContent: "center" },
});
