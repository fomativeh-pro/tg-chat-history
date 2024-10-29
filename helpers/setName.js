module.exports = setName = (userData) => {
  let nameString = "";

  if (userData?.first_name) {
    return (nameString += userData.first_name);
  }

  if (userData?.last_name) {
    return (nameString += ` ${userData.last_name}`); //firstname + lastname
  }

  if (!userData?.first_name && !userData?.last_name) {
    if (userData?.username) {
      nameString = userData.username;
    } else {
      nameString = "My friend";
    }
  }

  return nameString;
};
