import { Schema, model, Document, Types } from 'mongoose';

export interface ITor extends Document {
  name: string;
  description?: string;
  requirements?: string;
  document_link?: string;
  source?: {                        //replaces tor_sources table
    name: string;
    enabled: boolean;
    source_type?: string;
  };
  tech_stacks: Types.ObjectId[];    // replaces tor_tech_stacks join table
}

const torSchema = new Schema<ITor>({
  name: { type: String, required: true },
  description: String,
  requirements: String,
  document_link: String,
  source: {
    name: String,
    enabled: { type: Boolean, default: true },
    source_type: String
  },
  //array references TechStack 
  tech_stacks: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'TechStack' 
  }]
});

export const Tor = model<ITor>('Tor', torSchema);