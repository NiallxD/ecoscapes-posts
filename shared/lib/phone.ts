/** A phone, upright or on its side: a touch screen under 600px either way.
 *  The pages built for a bigger screen (the Data Sandbox, the Cycle) show
 *  shared/components/PhoneGate.astro instead, whose CSS has the same test,
 *  and stop their scripts before loading a map. */
export const PHONE = '(pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 599px)';
