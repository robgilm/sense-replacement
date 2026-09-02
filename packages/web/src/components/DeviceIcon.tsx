import {
  Car,
  Coffee,
  DoorOpen,
  Droplet,
  Fan,
  Flame,
  Lightbulb,
  type LucideIcon,
  Microwave,
  Monitor,
  Plug,
  Refrigerator,
  Snowflake,
  Thermometer,
  Tv,
  WashingMachine,
  Zap,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  fridge: Refrigerator,
  ac: Snowflake,
  dryer: WashingMachine,
  washer: WashingMachine,
  stove: Flame,
  oven: Flame,
  car: Car,
  alwayson: Plug,
  home: Plug,
  heat: Thermometer,
  lightbulb: Lightbulb,
  light: Lightbulb,
  microwave: Microwave,
  dishwasher: Droplet,
  pump: Droplet,
  fan: Fan,
  tv: Tv,
  computer: Monitor,
  garage: DoorOpen,
  toaster: Flame,
  kettle: Coffee,
};

export function DeviceIcon({
  icon,
  className,
  size = 20,
}: {
  icon: string | null;
  className?: string;
  size?: number;
}) {
  const Icon = (icon && ICONS[icon.toLowerCase()]) || Zap;
  return <Icon size={size} className={className} aria-hidden strokeWidth={2} />;
}
