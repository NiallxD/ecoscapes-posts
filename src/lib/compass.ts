/**
 * The phone's compass, the same way wherever it is used (the panorama lining
 * itself up with the landscape, the map's facing cone).
 *
 * iOS gives a true heading as `webkitCompassHeading` on the ordinary
 * deviceorientation event, and only after `requestPermission()` has been asked
 * inside a tap. Android gives a magnetic heading as the `alpha` of an absolute
 * event, counted anticlockwise, with nothing to ask -- so it is turned round and
 * pulled onto true north with the local declination.
 */

/** The event type that exists at all, or undefined on a machine without the
 *  sensor API (most desktops). */
const DOE = typeof window === 'undefined' ? undefined : (window as any).DeviceOrientationEvent;

/** True where the compass is behind a permission that needs a tap (iOS). */
export const needsTap = () => Boolean(DOE) && typeof DOE.requestPermission === 'function';

/** Whether this device has an orientation sensor API to use at all. */
export const hasCompassApi = () => Boolean(DOE);

/**
 * Ask for the compass. Call it from inside a tap: iOS shows its prompt the first
 * time and answers at once after that. True when it may be used -- granted, or
 * nothing to ask.
 */
export async function requestCompass(): Promise<boolean> {
  if (!DOE) return false;
  if (typeof DOE.requestPermission !== 'function') return true;
  try {
    return (await DOE.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** The screen's own turn: the compass measures the phone's top edge, and held
 *  sideways, the top of the screen is a quarter turn from it. */
const screenAngle = () =>
  (typeof screen !== 'undefined' && screen.orientation?.angle) ?? (window as any).orientation ?? 0;

/**
 * Degrees clockwise from true north that the top of the screen faces, from one
 * orientation event -- or null if this event carries no heading.
 *
 * `declination` is degrees east of true north that a magnetic compass reads at
 * this place; only used for Android's magnetic heading.
 */
export function headingOf(e: any, declination: number): number | null {
  let h: number | null = null;
  if (typeof e?.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    h = e.webkitCompassHeading;
  } else if (e?.absolute && typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
    h = 360 - e.alpha + declination;
  }
  return h === null ? null : (((h + screenAngle()) % 360) + 360) % 360;
}

/** The events a heading can arrive on: which one carries it is what differs by
 *  platform, so both are listened to. */
export const ORIENTATION_EVENTS = ['deviceorientationabsolute', 'deviceorientation'] as const;
