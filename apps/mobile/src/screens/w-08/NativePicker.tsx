type Props = { label: string; mode: "date" | "time"; date: string; time: string; zone: string; onChange: (value: string) => void };
// Web uses the always-visible typed inputs alongside the native picker on devices.
export function NativePicker(_props: Props) { return null; }
