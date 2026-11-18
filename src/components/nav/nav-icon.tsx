import {
  Activity,
  ClipboardCheck,
  HeartPulse,
  History,
  LayoutDashboard,
  type LucideProps,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Upload,
  UserPen,
  Users,
  UserSearch,
} from "lucide-react";
import type { NavIcon as NavIconKey } from "./nav-items";

const ICONS = {
  executive: LayoutDashboard,
  completion: ClipboardCheck,
  indicators: Activity,
  qualitative: MessageSquareText,
  selfAssessment: UserPen,
  goals: Target,
  dm360: Users,
  engagement: HeartPulse,
  upload: Upload,
  imports: History,
  identity: UserSearch,
  dataQuality: ShieldCheck,
  insightsSettings: SlidersHorizontal,
} satisfies Record<NavIconKey, React.ComponentType<LucideProps>>;

/** Thin line icon of a section (brand: simple, white on dark, teal on light). */
export function NavIcon({
  icon,
  ...props
}: { icon: NavIconKey } & LucideProps) {
  const Icon = ICONS[icon];
  return <Icon strokeWidth={1.6} aria-hidden="true" {...props} />;
}
