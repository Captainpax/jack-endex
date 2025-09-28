import mongoose from '../lib/mongoose.js';

const healingSchema = new mongoose.Schema(
    {
        hp: { type: Number, default: null },
        hpPercent: { type: Number, default: null },
        mp: { type: Number, default: null },
        mpPercent: { type: Number, default: null },
        revive: { type: String, enum: ['partial', 'full'], default: null },
    },
    { _id: false, minimize: false },
);

const effectSchema = new mongoose.Schema(
    {
        id: { type: String, default: '' },
        kind: { type: String, default: '' },
        trigger: { type: String, default: '' },
        interval: { type: Number, default: null },
        duration: { type: Number, default: null },
        value: { type: String, default: '' },
        notes: { type: String, default: '' },
    },
    { _id: false, minimize: false },
);

const itemSchema = new mongoose.Schema(
    {
        slug: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true, index: true },
        category: { type: String, default: '' },
        subcategory: { type: String, default: '' },
        type: { type: String, default: '' },
        desc: { type: String, default: '' },
        slot: { type: String, default: '' },
        tags: { type: [String], default: [] },
        order: { type: Number, default: 0 },
        healing: { type: healingSchema, default: undefined },
        effects: { type: [effectSchema], default: undefined },
    },
    {
        timestamps: true,
        minimize: false,
    },
);

itemSchema.index({ name: 'text', desc: 'text', category: 'text', subcategory: 'text', tags: 'text' });

itemSchema.pre('save', function normalizeFields(next) {
    if (typeof this.slug === 'string') {
        this.slug = this.slug.trim().toLowerCase();
    }
    if (typeof this.name === 'string') {
        this.name = this.name.trim();
    }
    if (typeof this.category === 'string') {
        this.category = this.category.trim();
    }
    if (typeof this.subcategory === 'string') {
        this.subcategory = this.subcategory.trim();
    }
    next();
});

export default mongoose.models.Item || mongoose.model('Item', itemSchema);
