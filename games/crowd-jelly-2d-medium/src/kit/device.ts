// "touch" or "mouse": goes into every analytics event as device_class.
// Starts from the media query and follows the pointer the player really uses.

export type DeviceClass = 'touch' | 'mouse';

let cls: DeviceClass = 'mouse';
try {
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) cls = 'touch';
} catch {
  /* keep the default */
}

const listeners: ((c: DeviceClass) => void)[] = [];

window.addEventListener(
  'pointerdown',
  (e) => {
    const next: DeviceClass = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    if (next !== cls) {
      cls = next;
      listeners.forEach((f) => f(cls));
    }
  },
  true,
);

export const deviceClass = (): DeviceClass => cls;
export const onDeviceChange = (f: (c: DeviceClass) => void): void => void listeners.push(f);
