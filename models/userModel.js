const { model, Schema } = require("mongoose");

const UserSchema = new Schema(
  {
    phone_number: { type: String, unique: true, required: true },
    session: { type: Object, required: true },
  },
  { timestamps: true }
);

const User = model("User", UserSchema);
module.exports = User;
