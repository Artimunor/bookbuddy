import DateTimePicker from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform } from "react-native";
import { Button } from "../../ui/controls";
import { wallInstant } from "./Screen";

type Props = { label: string; mode: "date" | "time"; date: string; time: string; zone: string; onChange: (value: string) => void };
export function NativePicker({ label, mode, date, time, zone, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [y, m, d] = date.split("-").map(Number); const [h, min] = time.split(":").map(Number);
  const validDate = !!y && !!m && !!d; const wallDate = validDate ? date : new Date().toISOString().slice(0, 10);
  const wallTime = Number.isFinite(h) && Number.isFinite(min) ? time : "09:00";
  const instant = wallInstant(wallDate, wallTime, zone);
  const [year, month, day] = wallDate.split("-").map(Number);
  const value = Platform.OS === "android" ? new Date(year!, month! - 1, day!, h || 0, min || 0) : new Date(instant ?? Date.now());
  function select(value: Date) {
    setOpen(false);
    if (Platform.OS === "android") {
      const pad = (n: number) => String(n).padStart(2, "0");
      onChange(mode === "date" ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : `${pad(value.getHours())}:${pad(value.getMinutes())}`);
      return;
    }
    const options: Intl.DateTimeFormatOptions = mode === "date" ? { year: "numeric", month: "2-digit", day: "2-digit" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { ...options, timeZone: zone }).formatToParts(value).map(p => [p.type, p.value]));
    onChange(mode === "date" ? `${parts.year}-${parts.month}-${parts.day}` : `${parts.hour}:${parts.minute}`);
  }
  return <><Button variant="quiet" label={label} onPress={() => setOpen(!open)} />{open && <DateTimePicker mode={mode} value={value} timeZoneName={zone} display={Platform.OS === "android" ? "spinner" : "compact"} is24Hour onValueChange={(_, value) => select(value)} onDismiss={() => setOpen(false)} />}</>;
}
