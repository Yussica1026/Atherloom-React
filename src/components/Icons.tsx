import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };

export function MenuIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

export function PlusIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M12 5v14M5 12h14" /></svg>;
}

export function SettingsIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="12" cy="12" r="3.2" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 14.7 6l-.3-2.6h-4L10.1 6a8 8 0 0 0-1.8 1.1l-2.4-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1.1l.3 2.6h4l.3-2.6a8 8 0 0 0 1.8-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></svg>;
}

export function SendIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></svg>;
}

export function StopIcon(props: IconProps) {
  return <svg viewBox="0 0 24 24" fill="currentColor" {...props}><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>;
}

export function SearchIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 4.5 4.5" /></svg>;
}

export function CloseIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

export function SparkIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="12" cy="12" r="2.7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9l3.5 3.5M15.6 15.6l3.5 3.5M19.1 4.9l-3.5 3.5M8.4 15.6l-3.5 3.5" /></svg>;
}
