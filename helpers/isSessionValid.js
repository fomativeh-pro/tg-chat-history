module.exports = isSessionValid = (userData) => {
  // Get the current date
  const now = new Date();

  // Convert createdAt string back to a Date object
  const createdAt = userData.updatedAt
    ? new Date(userData.updatedAt)
    : new Date(userData.createdAt);

  // Calculate the difference in milliseconds
  const differenceInMillis = now - createdAt;

  // Calculate the number of milliseconds in 5 days
  const fiveDaysInMillis = 5 * 24 * 60 * 60 * 1000; // 5 days

  // Check if the createdAt date is older than 5 days
  const userSessionIsValid = differenceInMillis < fiveDaysInMillis;
  return userSessionIsValid;
};
