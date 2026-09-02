export function isSameAuthenticatedUser(currentUser, nextUser) {
  return Boolean(nextUser?.id && currentUser?.id === nextUser.id);
}