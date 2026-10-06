import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { accountApi, type RetailerLink } from '../services/accountApi';
import { commerceApi, type Contact, type Product } from '../services/commerceApi';
import { colors, spacing } from '../theme/tokens';
import { Choice, Notice, Row, SectionTitle, decimal, parseDecimal, rupees } from './CommerceCommon';

export function ContactsScreen() {
  const { session } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]); const [products, setProducts] = useState<Product[]>([]);
  const [links, setLinks] = useState<RetailerLink[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null); const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(''); const [retailerId, setRetailerId] = useState<string | null>(null);
  const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [address, setAddress] = useState('');
  const [city, setCity] = useState(''); const [state, setState] = useState(''); const [postal, setPostal] = useState('');
  const [gstin, setGstin] = useState(''); const [notes, setNotes] = useState('');
  const [priceContact, setPriceContact] = useState<Contact | null>(null); const [priceUnit, setPriceUnit] = useState(''); const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const [contactResult, productResult, linkResult] = await Promise.all([
        commerceApi.contacts(session.access_token), commerceApi.products(session.access_token), accountApi.links(session.access_token)]);
      setContacts(contactResult.contacts); setProducts(productResult.products.filter((item) => !item.archived_at));
      setLinks(linkResult.links.filter((link) => link.status === 'active')); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load contacts'); }
    finally { setLoading(false); }
  }, [session]);
  useEffect(() => { void load(); }, [load]);
  function open(contact?: Contact) {
    setEditing(contact ?? null); setFormOpen(true); setError(null); setMessage(null);
    setName(contact?.name ?? ''); setRetailerId(contact?.retailer_business_id ?? null); setPhone(contact?.phone ?? ''); setEmail(contact?.email ?? '');
    setAddress(contact?.address_line1 ?? ''); setCity(contact?.city ?? ''); setState(contact?.state ?? ''); setPostal(contact?.postal_code ?? '');
    setGstin(contact?.gstin ?? ''); setNotes(contact?.notes ?? '');
  }
  async function save() {
    if (!session) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await commerceApi.saveContact(session.access_token, { name: name.trim(), retailer_business_id: retailerId,
        phone: phone.trim() || null, email: email.trim() || null, address_line1: address.trim() || null, address_line2: null,
        city: city.trim() || null, state: state.trim() || null, postal_code: postal.trim() || null,
        gstin: gstin.trim().toUpperCase() || null, notes: notes.trim() || null }, editing?.id);
      setFormOpen(false); setMessage(editing ? 'Retailer updated.' : 'Retailer added.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save retailer'); }
    finally { setBusy(false); }
  }
  async function archive(contact: Contact) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      if (contact.archived_at) await commerceApi.restoreContact(session.access_token, contact.id);
      else await commerceApi.archiveContact(session.access_token, contact.id);
      setMessage(`${contact.name} ${contact.archived_at ? 'restored' : 'archived'}.`); await load();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive retailer'); }
    finally { setBusy(false); }
  }
  async function savePrice() {
    if (!session || !priceContact || !priceUnit) return;
    setBusy(true); setError(null);
    try {
      const amount = price.trim() ? parseDecimal(price, 2, 'retailer price') : null;
      await commerceApi.setPrice(session.access_token, priceContact.id, priceUnit, amount);
      setMessage(amount === null ? 'Special price removed.' : 'Special price saved.'); await load(); setPriceContact(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save price'); }
    finally { setBusy(false); }
  }
  const units = products.flatMap((product) => product.units.filter((unit) => unit.active).map((unit) => ({ ...unit, productName: product.name })));
  return <Screen>
    <View style={styles.header}><SectionTitle>Retailer contacts</SectionTitle><AppButton title="Add retailer" onPress={() => open()} /></View>
    <Notice error={error} message={message} />
    {formOpen ? <AppCard style={styles.card}>
      <SectionTitle>{editing ? 'Edit retailer' : 'New retailer'}</SectionTitle>
      <AppField label="Retailer name" value={name} onChangeText={setName} />
      <Text style={styles.label}>Linked app account (optional)</Text>
      <Row><Choice title="Manual contact" selected={!retailerId} onPress={() => setRetailerId(null)} />
        {links.map((link) => <Choice key={link.id} title={link.retailer?.name ?? 'Retailer'} selected={retailerId === link.retailer_business_id}
          onPress={() => setRetailerId(link.retailer_business_id)} />)}</Row>
      <Row><View style={styles.field}><AppField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></View>
        <View style={styles.field}><AppField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" /></View></Row>
      <AppField label="Address" value={address} onChangeText={setAddress} />
      <Row><View style={styles.field}><AppField label="City" value={city} onChangeText={setCity} /></View>
        <View style={styles.field}><AppField label="State" value={state} onChangeText={setState} /></View>
        <View style={styles.field}><AppField label="Postal code" value={postal} onChangeText={setPostal} keyboardType="number-pad" /></View></Row>
      <AppField label="GSTIN (optional)" value={gstin} onChangeText={setGstin} autoCapitalize="characters" />
      <AppField label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Row><AppButton title={busy ? 'Saving…' : 'Save retailer'} disabled={busy} onPress={() => void save()} />
        <AppButton title="Cancel" variant="secondary" onPress={() => setFormOpen(false)} /></Row>
    </AppCard> : null}
    {priceContact ? <AppCard style={styles.card}>
      <SectionTitle>Price for {priceContact.name}</SectionTitle>
      <Text style={styles.muted}>Choose a product unit. Leave the price empty to use its standard price.</Text>
      <View style={styles.choices}>{units.map((unit) => <Choice key={unit.id} title={`${unit.productName} · ${unit.unit_name}`}
        subtitle={`Standard ${rupees(unit.standard_price_paise)}`} selected={priceUnit === unit.id}
        onPress={() => { setPriceUnit(unit.id); const existing = priceContact.prices.find((item) => item.product_unit_id === unit.id);
          setPrice(existing ? decimal(existing.price_paise, 2) : ''); }} />)}</View>
      {priceUnit ? <AppField label="Special price (₹)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" /> : null}
      <Row><AppButton title="Save price" disabled={!priceUnit || busy} onPress={() => void savePrice()} />
        <AppButton title="Close" variant="secondary" onPress={() => setPriceContact(null)} /></Row>
    </AppCard> : null}
    {loading ? <ActivityIndicator color={colors.primary} /> : contacts.length === 0 ? <Text style={styles.muted}>No retailers added yet.</Text> :
      <View style={styles.choices}>{contacts.map((contact) => <AppCard key={contact.id} style={styles.contact}>
        <Text style={styles.name}>{contact.name}{contact.archived_at ? ' (archived)' : ''}</Text>
        <Text style={styles.muted}>{contact.retailer_business_id ? 'Linked app account' : 'Manual contact'} · {contact.state ?? 'State missing'}</Text>
        <Text style={styles.muted}>{contact.prices.length} special price{contact.prices.length === 1 ? '' : 's'}</Text>
        <Row><AppButton title="Edit" variant="secondary" onPress={() => open(contact)} />
          {!contact.archived_at ? <AppButton title="Prices" variant="secondary" onPress={() => { setPriceContact(contact); setPriceUnit(''); setPrice(''); }} /> : null}
          <AppButton title={contact.archived_at ? 'Restore' : 'Archive'} variant="secondary" disabled={busy} onPress={() => void archive(contact)} /></Row>
      </AppCard>)}</View>}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md },
  card: { gap: spacing.lg }, field: { flexGrow: 1, flexBasis: 170, minWidth: 0 },
  label: { color: colors.ink, fontWeight: '700' }, muted: { color: colors.muted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  contact: { flexGrow: 1, flexBasis: 300, minWidth: 0, gap: spacing.md },
  name: { color: colors.ink, fontSize: 18, fontWeight: '800' }
});
