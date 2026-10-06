import { AppField } from './AppField';

export type BusinessFormValues = {
  name: string; phone: string; address_line1: string; address_line2: string;
  city: string; state: string; postal_code: string; gstin: string;
};

export const emptyBusinessForm: BusinessFormValues = {
  name: '', phone: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', gstin: ''
};

export function BusinessFields({ values, setField }: {
  values: BusinessFormValues;
  setField: (field: keyof BusinessFormValues, value: string) => void;
}) {
  return <>
    <AppField label="Business name" value={values.name} onChangeText={(value) => setField('name', value)} placeholder="Your registered or trading name" />
    <AppField label="Business phone" value={values.phone} onChangeText={(value) => setField('phone', value)} keyboardType="phone-pad" placeholder="Optional" />
    <AppField label="Address line 1" value={values.address_line1} onChangeText={(value) => setField('address_line1', value)} placeholder="Street and building" />
    <AppField label="Address line 2" value={values.address_line2} onChangeText={(value) => setField('address_line2', value)} placeholder="Optional" />
    <AppField label="City" value={values.city} onChangeText={(value) => setField('city', value)} placeholder="City" />
    <AppField label="State" value={values.state} onChangeText={(value) => setField('state', value)} placeholder="State" />
    <AppField label="PIN code" value={values.postal_code} onChangeText={(value) => setField('postal_code', value)} keyboardType="number-pad" placeholder="6 digits" />
    <AppField label="GSTIN (optional)" hint="Add GST details only if your business is registered." value={values.gstin} onChangeText={(value) => setField('gstin', value.toUpperCase())} placeholder="15-character GSTIN" />
  </>;
}
