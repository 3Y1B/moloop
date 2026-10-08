/** Native pushes are not a web capability. Avoid importing their SDK during browser/server rendering. */
export function configurePushHandling() {}

export function PushNotifications() {
  return null;
}
