import { Schema, model, Document } from 'mongoose';

export interface ITechStack extends Document {
  name: string;
}

const techStackSchema = new Schema<ITechStack>({
  name: { type: String, required: true, unique: true }
});

export const TechStack = model<ITechStack>('TechStack', techStackSchema);