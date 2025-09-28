import mongoose from '../lib/mongoose.js';

const userSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, unique: true, index: true },
        username: { type: String, required: true, unique: true, index: true },
        pass: { type: String, required: true },
        email: {
            type: String,
            lowercase: true,
            trim: true,
            unique: true,
            sparse: true,
        },
        banned: { type: Boolean, default: false },
    },
    {
        timestamps: true,
        minimize: false,
    },
);

export default mongoose.models.User || mongoose.model('User', userSchema);
