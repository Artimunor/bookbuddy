import { native } from "@bookbuddy/design-tokens";
import { useEffect, useId, useRef, type ComponentRef, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBeaconTheme } from "../theme";
import { Button, type ButtonVariant, type ControlAction } from "./actions";
import { Copy, controlMetrics } from "./shared";

export type OverlayProps = {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** The opening control. Browser Modal restores its own keyboard focus. */
  returnFocusRef?: RefObject<ComponentRef<typeof View> | null>;
};

export type SheetProps = OverlayProps & { dock?: ReactNode };

export function Sheet({ dock, ...props }: SheetProps) {
  return <Overlay {...props} kind="sheet" footer={dock} />;
}

export type DialogProps = OverlayProps & {
  cancel: ControlAction;
  confirm: ControlAction & { variant?: Extract<ButtonVariant, "primary" | "live" | "destructive"> };
  actionOrder?: "cancel-first" | "confirm-first";
};

export function Dialog({ cancel, confirm, actionOrder = "cancel-first", ...props }: DialogProps) {
  const { color, field, space } = useBeaconTheme();
  const { variant, ...action } = confirm;
  const confirmFirst = actionOrder === "confirm-first";
  const cancelButton = <Button key="cancel" {...cancel} variant="neutral" />;
  const confirmButton = <Button key="confirm" {...action} variant={variant} />;
  return (
    <Overlay {...props} kind="dialog" footer={(
      <View style={{
        padding: space.contentInset,
        gap: variant === "destructive" ? native.hitTargets.destructiveActionGap : controlMetrics(field).controlGap,
        borderTopWidth: 1,
        borderTopColor: color.separator,
        backgroundColor: color.surface,
      }}>
        {confirmFirst ? confirmButton : cancelButton}
        {confirmFirst ? cancelButton : confirmButton}
      </View>
    )} />
  );
}

function Overlay({ visible, title, closeLabel, onClose, children, returnFocusRef, kind, footer }: OverlayProps & {
  kind: "sheet" | "dialog";
  footer?: ReactNode;
}) {
  const { scheme, color, field, radius, space } = useBeaconTheme();
  const { height, fontScale } = useWindowDimensions();
  // Let even the footer scroll on a short display or with very large text.
  const scrollFooter = height < 520 || fontScale >= 1.5;
  const titleId = useId();
  const titleRef = useRef<ComponentRef<typeof View>>(null);
  const wasVisible = useRef(false);
  const focusTrigger = () => {
    if (returnFocusRef?.current) AccessibilityInfo.sendAccessibilityEvent(returnFocusRef.current, "focus");
  };

  useEffect(() => {
    const closing = wasVisible.current && !visible;
    wasVisible.current = visible;
    // iOS has onDismiss; Android does not. The Android modal is not animated.
    if (closing && Platform.OS === "android") {
      const frame = requestAnimationFrame(() => {
        if (returnFocusRef?.current) AccessibilityInfo.sendAccessibilityEvent(returnFocusRef.current, "focus");
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [returnFocusRef, visible]);

  function requestClose() {
    if (Platform.OS !== "web" && Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  }

  const sheet = kind === "sheet";
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      {...(Platform.OS === "web" ? { "aria-labelledby": titleId } : undefined)}
      onRequestClose={requestClose}
      onDismiss={Platform.OS === "ios" ? focusTrigger : undefined}
      onShow={() => {
        if (Platform.OS !== "web" && titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
      }}
    >
      <SafeAreaView style={[styles.fill, { backgroundColor: native.scrim[scheme] }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.fill, sheet ? styles.sheetPosition : styles.dialogPosition, !sheet && { padding: space.grid[4] }]}
        >
          <View
            accessibilityViewIsModal
            style={[styles.panel, {
              backgroundColor: color.raised,
              borderTopStartRadius: sheet ? radius.sheetTop : radius.card,
              borderTopEndRadius: sheet ? radius.sheetTop : radius.card,
              borderBottomStartRadius: sheet ? 0 : radius.card,
              borderBottomEndRadius: sheet ? 0 : radius.card,
              borderColor: color.separator,
              borderWidth: 1,
            }, !sheet && styles.dialog]}
          >
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
              <View style={{ padding: space.contentInset, gap: space.grid[2] }}>
                {sheet && <View style={[styles.handle, { backgroundColor: color.outline, borderRadius: radius.pill }]} />}
                <View ref={titleRef} accessible accessibilityRole="header" accessibilityLabel={title} nativeID={titleId}>
                  <Copy variant="sectionTitle">{title}</Copy>
                </View>
                <View style={styles.close}>
                  <Button label={closeLabel} onPress={onClose} variant="quiet" />
                </View>
              </View>
              <View style={{ paddingHorizontal: space.contentInset, paddingBottom: space.contentInset, gap: controlMetrics(field).controlGap }}>
                {children}
              </View>
              {scrollFooter && footer}
            </ScrollView>
            {!scrollFooter && footer}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheetPosition: { justifyContent: "flex-end", alignItems: "stretch" },
  dialogPosition: { justifyContent: "center", alignItems: "center" },
  panel: { maxHeight: "100%", flexShrink: 1 },
  dialog: { width: "100%", maxWidth: 480 },
  handle: { height: 4, width: 32, alignSelf: "center" },
  close: { alignSelf: "flex-start", maxWidth: "100%" },
  body: { flexGrow: 0, flexShrink: 1 },
});
