import mongoose from '../lib/mongoose.js';

const serverSettingSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, index: true },
        value: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    {
        timestamps: true,
        minimize: false,
    },
);

export default mongoose.models.ServerSetting || mongoose.model('ServerSetting', serverSettingSchema);
