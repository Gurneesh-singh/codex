import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { RootStackParams } from '../../App';
import { useAuth } from '../auth/AuthProvider';
import { AppButton } from '../components/AppButton';
import { AppCard } from '../components/AppCard';
import { AppField } from '../components/AppField';
import { Screen } from '../components/Screen';
import { accountApi, type RetailerLink } from '../services/accountApi';
import { commerceApi, type Contact, type DocumentKind, type Order, type OrderDetail, type Product,
  type PdfDocument, type ReceivedBill, type SentBill } from '../services/commerceApi';
import { orderAppLink } from '../services/orderLinks';
import { colors, spacing } from '../theme/tokens';
import { Choice, Notice, Row, SectionTitle, decimal, parseDecimal, rupees } from './CommerceCommon';

type LineForm = { source: 'catalog' | 'one_off'; product_unit_id: string; product_name: string; unit_name: string;
  gst_rate: string; hsn_code: string; quantity: string; rate: string; discount: string; instructions: string };
const newLine = (): LineForm => ({ source: 'catalog', product_unit_id: '', product_name: '', unit_name: '',
  gst_rate: '', hsn_code: '', quantity: '1', rate: '', discount: '0', instructions: '' });
type Props = NativeStackScreenProps<RootStackParams, 'Orders'>;

export function OrdersScreen({ navigation, route }: Props) {
  const { session, account } = useAuth(); const supplier = account?.business?.kind === 'supplier';
  const scrollViewRef = useRef<ScrollView>(null);
  const [orders, setOrders] = useState<Order[]>([]); const [contacts, setContacts] = useState<Contact[]>([]);
  const [links, setLinks] = useState<RetailerLink[]>([]); const [sentBills, setSentBills] = useState<SentBill[]>([]);
  const [receivedBills, setReceivedBills] = useState<ReceivedBill[]>([]);
  const [deliveryOpen, setDeliveryOpen] = useState(false); const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientId, setRecipientId] = useState(''); const [documentKind, setDocumentKind] = useState<DocumentKind>('confirmation');
  const [acknowledgeOtherRecipient, setAcknowledgeOtherRecipient] = useState(false);
  const [products, setProducts] = useState<Product[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null); const [formOpen, setFormOpen] = useState(false); const [editingId, setEditingId] = useState<string | null>(null);
  const [contactId, setContactId] = useState(''); const [place, setPlace] = useState(''); const [instructions, setInstructions] = useState('');
  const [lines, setLines] = useState<LineForm[]>([newLine()]); const [paid, setPaid] = useState('0');
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [shareDocument, setShareDocument] = useState<PdfDocument | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const orderResult = await commerceApi.orders(session.access_token);
      setOrders(orderResult.orders);
      if (supplier) {
        const [contactResult, productResult, linkResult] = await Promise.all([
          commerceApi.contacts(session.access_token), commerceApi.products(session.access_token), accountApi.links(session.access_token)]);
        setContacts(contactResult.contacts.filter((contact) => !contact.archived_at));
        setProducts(productResult.products.filter((product) => !product.archived_at));
        setLinks(linkResult.links.filter((link) => link.status === 'active'));
      } else setReceivedBills((await commerceApi.receivedBills(session.access_token)).deliveries);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load orders'); }
    finally { setLoading(false); }
  }, [session, supplier]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const show = useCallback(async (id: string, openDelivery = false) => {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const [result, sent] = await Promise.all([commerceApi.order(session.access_token, id),
        supplier ? commerceApi.sentBills(session.access_token, id) : Promise.resolve({ deliveries: [] as SentBill[] })]);
      setDetail(result); setPaid(decimal(result.order.paid_paise, 2));
      setSentBills(sent.deliveries); setDeliveryOpen(openDelivery);
      setRecipientId(result.order.retailer_business_id ?? ''); setRecipientSearch('');
      setDocumentKind(result.order.status === 'invoiced' ? 'invoice' : 'confirmation');
      setAcknowledgeOtherRecipient(false);
      requestAnimationFrame(() => scrollViewRef.current?.scrollTo({ y: 0, animated: true }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open order'); }
    finally { setBusy(false); }
  }, [session, supplier]);
  useEffect(() => {
    const target = route.params?.orderId;
    if (!target) return;
    void show(target, Boolean(route.params?.openSend));
    if (route.params?.notice) setMessage(route.params.notice);
    navigation.setParams({ orderId: undefined, openSend: undefined, notice: undefined });
  }, [route.params?.orderId, route.params?.openSend, route.params?.notice, navigation, show]);
  function openNew() { setDetail(null); setEditingId(null); setContactId(''); setPlace(''); setInstructions(''); setLines([newLine()]); setFormOpen(true); setError(null); }
  function editDraft() {
    if (!detail || detail.order.status !== 'draft') return;
    setEditingId(detail.order.id); setContactId(detail.order.retailer_contact_id); setPlace(detail.order.place_of_supply_state);
    setInstructions(detail.order.instructions ?? ''); setLines(detail.lines.map((line) => ({
      source: line.source, product_unit_id: line.product_unit_id ?? '', product_name: line.product_name,
      unit_name: line.unit_name, gst_rate: decimal(line.gst_rate_bps, 2), hsn_code: line.hsn_code ?? '',
      quantity: decimal(line.quantity_milli, 3), rate: decimal(line.rate_paise, 2), discount: decimal(line.discount_bps, 2),
      instructions: line.instructions ?? '' })));
    setFormOpen(true); setDetail(null); setError(null);
  }
  function updateLine(index: number, change: Partial<LineForm>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...change } : line)); }
  async function save() {
    if (!session) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      if (!contactId) throw new Error('Choose a retailer');
      const data = { retailer_contact_id: contactId, place_of_supply_state: place.trim(), instructions: instructions.trim() || null,
        lines: lines.map((line, index) => {
          const quantity_milli = parseDecimal(line.quantity, 3, `item ${index + 1} quantity`);
          const discount_bps = parseDecimal(line.discount, 2, `item ${index + 1} discount`);
          const lineInstructions = line.instructions.trim() || null;
          if (line.source === 'one_off') {
            const hsn_code = line.hsn_code.trim() || null;
            if (hsn_code && !/^[0-9]{4,8}$/.test(hsn_code)) throw new Error(`Item ${index + 1}: HSN must be 4–8 digits`);
            return { source: 'one_off' as const, product_name: line.product_name.trim(), unit_name: line.unit_name.trim(),
              gst_rate_bps: parseDecimal(line.gst_rate, 2, 'GST rate'), hsn_code, quantity_milli,
              rate_paise: parseDecimal(line.rate, 2, 'rate'), discount_bps, instructions: lineInstructions };
          }
          return { product_unit_id: line.product_unit_id, quantity_milli,
            ...(line.rate.trim() ? { rate_paise: parseDecimal(line.rate, 2, 'rate') } : {}),
            discount_bps, instructions: lineInstructions };
        }) };
      await commerceApi.saveOrder(session.access_token, data, editingId ?? undefined);
      setFormOpen(false); setMessage(editingId ? 'Draft updated.' : 'Draft order created.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save order'); }
    finally { setBusy(false); }
  }
  async function act(kind: 'confirm' | 'invoice' | 'payment' | 'whatsapp') {
    if (!session || !detail) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const order = detail.order;
      if (kind === 'confirm') await commerceApi.confirm(session.access_token, order.id);
      if (kind === 'invoice') await commerceApi.invoice(session.access_token, order.id);
      if (kind === 'payment') await commerceApi.payment(session.access_token, order.id, parseDecimal(paid, 2, 'paid amount'));
      if (kind === 'whatsapp') await commerceApi.whatsapp(order);
      if (kind === 'confirm' || kind === 'invoice' || kind === 'payment') { await load(); await show(order.id, kind !== 'payment'); }
      setMessage(kind === 'confirm' ? 'Order confirmed. Its confirmation PDF is ready to send.'
        : kind === 'invoice' ? 'Tax invoice issued. Its PDF is ready to send.' : kind === 'payment' ? 'Payment updated.' : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed'); }
    finally { setBusy(false); }
  }
  async function openPdf(kind: DocumentKind, share: boolean) {
    if (!session || !detail) return;
    setBusy(true); setError(null);
    try {
      const pdf = await commerceApi.pdf(session.access_token, detail.order, kind);
      if (share) setShareDocument(pdf);
      else if (Platform.OS === 'web') commerceApi.downloadPdf(pdf);
      else await commerceApi.sharePdf(pdf);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open PDF'); }
    finally { setBusy(false); }
  }
  async function sendBill() {
    if (!session || !detail || !selectedRecipient) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await commerceApi.sendBill(session.access_token, detail.order.id, recipientId, documentKind, acknowledgeOtherRecipient);
      setSentBills((await commerceApi.sentBills(session.access_token, detail.order.id)).deliveries);
      setMessage(result.delivery.already_sent ? 'This PDF was already sent to that retailer.' : 'Bill sent to the retailer’s in-app inbox.');
      setAcknowledgeOtherRecipient(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send bill'); }
    finally { setBusy(false); }
  }
  async function openReceivedBill(bill: ReceivedBill, share: boolean) {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const pdf = await commerceApi.deliveryPdf(session.access_token, bill);
      if (share) setShareDocument(pdf);
      else if (Platform.OS === 'web') commerceApi.downloadPdf(pdf);
      else await commerceApi.sharePdf(pdf);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open received bill'); }
    finally { setBusy(false); }
  }
  async function chooseDeviceShare() {
    if (!shareDocument) return;
    setBusy(true); setError(null);
    try { await commerceApi.sharePdf(shareDocument); setShareDocument(null); }
    catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError'))
        setError(cause instanceof Error ? cause.message : 'Could not share PDF');
    } finally { setBusy(false); }
  }
  function chooseWebShare(destination: 'whatsapp' | 'gmail' | 'email' | 'download') {
    if (!shareDocument || Platform.OS !== 'web') return;
    try {
      commerceApi.downloadPdf(shareDocument);
      if (destination !== 'download') {
        const target = destination === 'whatsapp' ? 'https://web.whatsapp.com/'
          : destination === 'gmail' ? 'https://mail.google.com/mail/u/0/#compose' : 'mailto:';
        window.open(target, '_blank', 'noopener,noreferrer');
        const app = destination === 'whatsapp' ? 'WhatsApp Web' : destination === 'gmail' ? 'Gmail' : 'your email app';
        setMessage(`PDF downloaded as ${shareDocument.filename}. Attach it in ${app}. If it did not open, open it manually.`);
      } else setMessage(`PDF downloaded as ${shareDocument.filename}.`);
      setShareDocument(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download PDF'); }
  }
  const units = products.flatMap((product) => product.units.filter((unit) => unit.active).map((unit) => ({ ...unit, productName: product.name })));
  const selectedContact = contacts.find((contact) => contact.id === contactId);
  const selectedRecipient = links.find((link) => link.retailer_business_id === recipientId);
  const otherRecipient = Boolean(detail && recipientId && recipientId !== detail.order.retailer_business_id);
  const taxInvoiceUnavailable = detail?.order.status === 'confirmed' && detail.order.tax_mode === 'none';

  return <Screen scrollViewRef={scrollViewRef}>
    <View style={styles.header}><SectionTitle>{supplier ? 'Orders and billing' : 'Bills and order history'}</SectionTitle>
      <Row>{supplier ? <AppButton title="Create order" onPress={openNew} /> : null}
        <AppButton title="Refresh" variant="secondary" disabled={loading} onPress={() => void load()} /></Row></View>
    <Notice error={error} message={message} />
    {formOpen && supplier ? <AppCard style={styles.card}>
      <SectionTitle>{editingId ? 'Edit draft order' : 'New draft order'}</SectionTitle>
      <Text style={styles.label}>Retailer</Text>
      <View style={styles.choices}>{contacts.map((contact) => <Choice key={contact.id} title={contact.name} subtitle={contact.state ?? 'State missing'}
        selected={contactId === contact.id} onPress={() => { setContactId(contact.id); setPlace(contact.state ?? ''); }} />)}</View>
      <AppField label="Place of supply state" value={place} onChangeText={setPlace} hint="Check the correct place of supply before billing." />
      <AppField label="Order instructions" value={instructions} onChangeText={setInstructions} multiline />
      <Text style={styles.label}>Items</Text>
      {lines.map((line, index) => {
        const selected = units.find((unit) => unit.id === line.product_unit_id);
        const special = selectedContact?.prices.find((item) => item.product_unit_id === selected?.id);
        return <View key={`line-${index}`} style={styles.line}>
          <Text style={styles.label}>Item {index + 1}</Text>
          <Row><Choice title="Inventory product" selected={line.source === 'catalog'} onPress={() => updateLine(index, { source: 'catalog' })} />
            <Choice title="One-off item" selected={line.source === 'one_off'} onPress={() => updateLine(index, { source: 'one_off' })} /></Row>
          {line.source === 'catalog' ? <View style={styles.choices}>{units.map((unit) => <Choice key={unit.id} title={`${unit.productName} · ${unit.unit_name}`}
            subtitle={rupees(selectedContact?.prices.find((item) => item.product_unit_id === unit.id)?.price_paise ?? unit.standard_price_paise)}
            selected={line.product_unit_id === unit.id} onPress={() => updateLine(index, { product_unit_id: unit.id, rate: '' })} />)}</View> : <>
            <Text style={styles.muted}>This item is not added to inventory or deducted from stock.</Text>
            <AppField label="Product name" value={line.product_name} onChangeText={(value) => updateLine(index, { product_name: value })} />
            <Row><View style={styles.field}><AppField label="Selling unit" value={line.unit_name} onChangeText={(value) => updateLine(index, { unit_name: value })} /></View>
              <View style={styles.field}><AppField label="GST rate %" value={line.gst_rate} keyboardType="decimal-pad" onChangeText={(value) => updateLine(index, { gst_rate: value })} /></View>
              <View style={styles.field}><AppField label="HSN code for tax invoice" value={line.hsn_code} keyboardType="number-pad" onChangeText={(value) => updateLine(index, { hsn_code: value })} /></View></Row>
          </>}
          <Row><View style={styles.field}><AppField label="Quantity" value={line.quantity} onChangeText={(value) => updateLine(index, { quantity: value })} keyboardType="decimal-pad" /></View>
            <View style={styles.field}><AppField label={line.source === 'one_off' ? 'Rate (₹)' : 'Rate (₹, optional override)'} value={line.rate} onChangeText={(value) => updateLine(index, { rate: value })}
              keyboardType="decimal-pad" hint={selected ? `Default ${rupees(special?.price_paise ?? selected.standard_price_paise)}` : undefined} /></View>
            <View style={styles.field}><AppField label="Discount %" value={line.discount} onChangeText={(value) => updateLine(index, { discount: value })} keyboardType="decimal-pad" /></View></Row>
          <AppField label="Item instructions" value={line.instructions} onChangeText={(value) => updateLine(index, { instructions: value })} />
          {lines.length > 1 ? <AppButton title="Remove item" variant="secondary" onPress={() => setLines((current) => current.filter((_, i) => i !== index))} /> : null}
        </View>;
      })}
      <AppButton title="Add item" variant="secondary" onPress={() => setLines((current) => [...current, newLine()])} />
      <Row><AppButton title={busy ? 'Saving…' : 'Save draft'} disabled={busy} onPress={() => void save()} />
        <AppButton title="Cancel" variant="secondary" onPress={() => setFormOpen(false)} /></Row>
    </AppCard> : null}
    {detail ? <AppCard style={styles.card}>
      <View style={styles.header}><SectionTitle>{detail.order.invoice_number ?? `Order ${detail.order.id.slice(0, 8)}`}</SectionTitle>
        <AppButton title="Close" variant="secondary" onPress={() => setDetail(null)} /></View>
      <Text style={styles.muted}>Status: {detail.order.status} · Payment: {detail.order.payment_status}</Text>
      <Text style={styles.muted}>Place of supply: {detail.order.place_of_supply_state} · Tax: {detail.order.tax_mode}</Text>
      {detail.lines.map((line) => <View key={line.id} style={styles.detailLine}>
        <Text style={styles.name}>{line.product_name} · {line.unit_name}{line.source === 'one_off' ? ' · one-off' : ''}</Text>
        <Text style={styles.muted}>{decimal(line.quantity_milli, 3)} × {rupees(line.rate_paise)} · Discount {decimal(line.discount_bps, 2)}% · GST {decimal(line.gst_rate_bps, 2)}%</Text>
        <Text style={styles.muted}>Taxable {rupees(line.taxable_paise)} · CGST {rupees(line.cgst_paise)} · SGST {rupees(line.sgst_paise)} · IGST {rupees(line.igst_paise)}</Text>
        <Text style={styles.name}>Line total {rupees(line.total_paise)}</Text>
      </View>)}
      <Text style={styles.name}>Subtotal {rupees(detail.order.subtotal_paise)} · Discount {rupees(detail.order.discount_paise)}</Text>
      <Text style={styles.muted}>Taxable {rupees(detail.order.taxable_paise)} · CGST {rupees(detail.order.cgst_paise)} · SGST {rupees(detail.order.sgst_paise)} · IGST {rupees(detail.order.igst_paise)}</Text>
      <Text style={styles.name}>Total {rupees(detail.order.total_paise)} · Paid {rupees(detail.order.paid_paise)}</Text>
      {supplier && detail.order.status === 'draft' ? <Row><AppButton title="Edit draft" variant="secondary" onPress={editDraft} />
        <AppButton title="Confirm order" disabled={busy} onPress={() => void act('confirm')} /></Row> : null}
      {supplier && detail.order.status === 'confirmed' ? <View style={styles.invoiceStatus}>
        {taxInvoiceUnavailable ? <>
          <Text style={styles.warning}>Tax invoice unavailable for this confirmed order: it was created without GST calculation.</Text>
          <Text style={styles.muted}>Download the order-confirmation PDF below. To issue a GST tax invoice, complete the supplier GSTIN, retailer address, and product HSN codes, then create a new order.</Text>
        </> : <>
          <Text style={styles.muted}>Tax invoice not issued yet. Use the button below after checking the GST and address details.</Text>
          <AppButton title="Issue tax invoice" disabled={busy} onPress={() => void act('invoice')} />
        </>}
      </View> : null}
      {detail.order.status === 'invoiced' ? <Text style={styles.name}>Tax invoice issued: {detail.order.invoice_number}</Text> : null}
      {supplier && detail.order.status !== 'draft' ? <Row><View style={styles.field}><AppField label="Amount paid (₹)" value={paid} onChangeText={setPaid} keyboardType="decimal-pad" /></View>
        <AppButton title="Save payment" disabled={busy} onPress={() => void act('payment')} /></Row> : null}
      {detail.order.status !== 'draft' ? <>
        <View style={styles.qrSection}>
          <Text style={styles.label}>Scan to open this order</Text>
          <View style={styles.qrCanvas}><QRCode value={orderAppLink(detail.order.id)} size={184} color={colors.ink} backgroundColor={colors.surface} /></View>
          <Text style={styles.muted}>Scan with a phone that has BoloVyapar installed. Sign in as the supplier or linked retailer to view this order.</Text>
        </View>
        <Text style={styles.label}>Order confirmation PDF</Text>
        <Row><AppButton title="Download confirmation" variant="secondary" disabled={busy} onPress={() => void openPdf('confirmation', false)} />
          <AppButton title="Share confirmation" variant="secondary" disabled={busy} onPress={() => void openPdf('confirmation', true)} /></Row>
        {detail.order.status === 'invoiced' ? <><Text style={styles.label}>Tax invoice PDF · {detail.order.invoice_number}</Text>
          <Row><AppButton title="Download invoice" disabled={busy} onPress={() => void openPdf('invoice', false)} />
            <AppButton title="Share invoice" variant="secondary" disabled={busy} onPress={() => void openPdf('invoice', true)} /></Row></> : null}
        <AppButton title="WhatsApp summary" variant="secondary" disabled={busy} onPress={() => void act('whatsapp')} />
        {supplier ? <AppButton title={deliveryOpen ? 'Hide in-app sending' : 'Send bill in app'} variant="secondary"
          onPress={() => setDeliveryOpen((value) => !value)} /> : null}
      </> : null}
      {supplier && deliveryOpen && detail.order.status !== 'draft' ? <View style={styles.delivery}>
        <SectionTitle>Send PDF to connected retailer</SectionTitle>
        <Text style={styles.muted}>Search by name or choose from all connected retailers. The recipient sees the PDF in their in-app bill inbox.</Text>
        <AppField label="Find connected retailer" value={recipientSearch} onChangeText={(value) => {
          setRecipientSearch(value); setRecipientId(''); setAcknowledgeOtherRecipient(false);
        }} hint="Clear the search to see everyone." />
        <View style={styles.choices}>{links.filter((link) => !recipientSearch ||
          (link.retailer?.name ?? '').toLocaleLowerCase().includes(recipientSearch.toLocaleLowerCase())).map((link) =>
          <Choice key={link.id} title={link.retailer?.name ?? 'Retailer'} selected={recipientId === link.retailer_business_id}
            onPress={() => { setRecipientId(link.retailer_business_id); setAcknowledgeOtherRecipient(false); }} />)}</View>
        {!links.length ? <Text style={styles.muted}>No connected retailers. Link a retailer account in Retailers first.</Text> : null}
        <Text style={styles.label}>Document to send</Text>
        <Row><Choice title="Order confirmation" selected={documentKind === 'confirmation'} onPress={() => setDocumentKind('confirmation')} />
          {detail.order.status === 'invoiced' ? <Choice title="Tax invoice" selected={documentKind === 'invoice'} onPress={() => setDocumentKind('invoice')} /> : null}</Row>
        {otherRecipient ? <>
          <Text style={styles.warning}>This PDF is billed to {detail.order.retailer_name ?? 'another retailer'}. You selected {selectedRecipient?.retailer?.name ?? 'another retailer'} to receive a copy.</Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: acknowledgeOtherRecipient }}
            onPress={() => setAcknowledgeOtherRecipient((value) => !value)}>
            <Text style={styles.warning}>{acknowledgeOtherRecipient ? '☑' : '☐'} I understand this recipient is different from the buyer named on the PDF</Text>
          </Pressable>
        </> : null}
        <AppButton title={busy ? 'Sending…' : 'Send PDF in app'} disabled={!selectedRecipient || busy || (otherRecipient && !acknowledgeOtherRecipient)}
          onPress={() => void sendBill()} />
        {sentBills.length ? <><Text style={styles.label}>Sent copies</Text>{sentBills.map((bill) =>
          <Text key={bill.id} style={styles.muted}>{bill.document_kind === 'invoice' ? 'Invoice' : 'Order confirmation'} → {bill.recipient_name} · {new Date(bill.sent_at).toLocaleString('en-IN')}</Text>)}</> : null}
      </View> : null}
    </AppCard> : null}
    {!supplier ? <AppCard style={styles.card}>
      <SectionTitle>Bills received in app</SectionTitle>
      {!receivedBills.length ? <Text style={styles.muted}>No bills have been sent to your account yet.</Text> : receivedBills.map((bill) =>
        <View key={bill.id} style={styles.detailLine}>
          <Text style={styles.name}>{bill.document_kind === 'invoice' ? `Tax invoice ${bill.invoice_number ?? ''}` : 'Order confirmation'}</Text>
          <Text style={styles.muted}>From {bill.supplier_name} · Billed to {bill.billed_to_name}</Text>
          <Text style={styles.muted}>{rupees(bill.total_paise)} · Sent {new Date(bill.sent_at).toLocaleString('en-IN')}</Text>
          <Row><AppButton title="Download PDF" variant="secondary" disabled={busy} onPress={() => void openReceivedBill(bill, false)} />
            <AppButton title="Share PDF" variant="secondary" disabled={busy} onPress={() => void openReceivedBill(bill, true)} /></Row>
        </View>)}</AppCard> : null}
    {loading ? <ActivityIndicator color={colors.primary} /> : orders.length === 0 ? <Text style={styles.muted}>No orders yet.</Text> :
      <View style={styles.choices}>{orders.map((order) => <AppCard key={order.id} style={styles.order}>
        <Text style={styles.name}>{order.invoice_number ?? `Order ${order.id.slice(0, 8)}`}</Text>
        <Text style={styles.muted}>{supplier ? order.retailer_name : order.supplier_name} · {new Date(order.created_at).toLocaleDateString('en-IN')}</Text>
        <Text style={styles.muted}>{order.status === 'confirmed' ? 'Confirmed · tax invoice not issued' : order.status} · {order.payment_status} · {rupees(order.total_paise)}</Text>
        <AppButton title="Open order" variant="secondary" onPress={() => void show(order.id)} />
      </AppCard>)}</View>}
    <Modal visible={Boolean(shareDocument)} transparent animationType="fade" onRequestClose={() => setShareDocument(null)}>
      <View style={styles.shareOverlay}>
        <AppCard style={styles.shareCard}>
          <SectionTitle>Share PDF</SectionTitle>
          <Text style={styles.muted}>{shareDocument?.filename}</Text>
          {Platform.OS === 'web' ? <>
            {shareDocument && commerceApi.canSharePdf(shareDocument)
              ? <AppButton title="Choose an app on this device" disabled={busy} onPress={() => void chooseDeviceShare()} /> : null}
            <AppButton title="WhatsApp Web" disabled={busy} onPress={() => chooseWebShare('whatsapp')} />
            <AppButton title="Gmail" disabled={busy} onPress={() => chooseWebShare('gmail')} />
            <AppButton title="Other email app" disabled={busy} onPress={() => chooseWebShare('email')} />
            <AppButton title="Download PDF" variant="secondary" disabled={busy} onPress={() => chooseWebShare('download')} />
            <Text style={styles.muted}>For WhatsApp Web or Gmail, the PDF downloads first. Attach it in the new tab before sending.</Text>
          </> : <AppButton title="Choose WhatsApp, Gmail, or another app" disabled={busy} onPress={() => void chooseDeviceShare()} />}
          <AppButton title="Cancel" variant="secondary" onPress={() => setShareDocument(null)} />
        </AppCard>
      </View>
    </Modal>
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md },
  card: { gap: spacing.lg }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  label: { color: colors.ink, fontWeight: '700' }, muted: { color: colors.muted }, name: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  field: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  line: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, gap: spacing.md },
  detailLine: { borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md, gap: spacing.xs },
  delivery: { gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.lg },
  invoiceStatus: { gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.md },
  warning: { color: colors.error, fontWeight: '700' },
  order: { flexGrow: 1, flexBasis: 280, minWidth: 0, gap: spacing.md },
  qrSection: { gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.lg, alignItems: 'flex-start' },
  qrCanvas: { backgroundColor: colors.surface, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  shareOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  shareCard: { width: '100%', maxWidth: 440, gap: spacing.md }
});
