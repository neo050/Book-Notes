export function isStrongPassword(pwd) {
  return /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(pwd);
}
