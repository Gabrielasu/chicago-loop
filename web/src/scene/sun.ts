/**
 * Where the sun is over the Loop at a moment: the NOAA solar position
 * equations, good to a fraction of a degree, which is plenty for shadows.
 */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Compass bearing, degrees (0 north, 90 east) */
  azimuth: number;
  /** Degrees above the horizon */
  elevation: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289;
  const trueLon = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLon - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD)) /
    RAD;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = (((minutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(Math.max(cosZen, -1), 1));
  const elevation = 90 - zenith / RAD;
  const azDen = Math.cos(phi) * Math.sin(zenith);
  let azimuth = 180;
  if (Math.abs(azDen) > 1e-6) {
    const cosAz = (Math.sin(phi) * Math.cos(zenith) - Math.sin(decl)) / azDen;
    const a = Math.acos(Math.min(Math.max(cosAz, -1), 1)) / RAD;
    azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { azimuth, elevation };
}

/** Night when the sun is more than a few degrees below the horizon (civil dusk). */
export function isNight(sun: SunPosition): boolean {
  return sun.elevation < -4;
}
