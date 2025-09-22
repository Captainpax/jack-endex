import mongoose from '../lib/mongoose.js';

const userSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, unique: true, index: true },
        username: { type: String, required: true, unique: true, index: true },
        pass: { type: String, required: true },
    },
    {
        timestamps: true,
        minimize: false,
    },
);

export default mongoose.models.User || mongoose.model('User', userSchema);
