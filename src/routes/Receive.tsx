import {
    Contact,
    MutinyBip21RawMaterials,
    MutinyInvoice
} from "@mutinywallet/mutiny-wasm";
import {
    createEffect,
    createMemo,
    createResource,
    createSignal,
    Match,
    onCleanup,
    Show,
    Switch
} from "solid-js";
import {
    Button,
    Card,
    DefaultMain,
    Indicator,
    LargeHeader,
    MutinyWalletGuard,
    SafeArea,
    SimpleDialog
} from "~/components/layout";
import NavBar from "~/components/NavBar";
import { useMegaStore } from "~/state/megaStore";
import { objectToSearchParams } from "~/utils/objectToSearchParams";
import mempoolTxUrl from "~/utils/mempoolTxUrl";
import { Amount, AmountSmall } from "~/components/Amount";
import { BackLink } from "~/components/layout/BackLink";
import { TagEditor } from "~/components/TagEditor";
import { StyledRadioGroup } from "~/components/layout/Radio";
import { showToast } from "~/components/Toaster";
import { useNavigate } from "solid-start";
import { AmountCard } from "~/components/AmountCard";
import { BackButton } from "~/components/layout/BackButton";
import { MutinyTagItem } from "~/utils/tags";
import { Network } from "~/logic/mutinyWalletSetup";
import { SuccessModal } from "~/components/successfail/SuccessModal";
import { MegaCheck } from "~/components/successfail/MegaCheck";
import { ExternalLink } from "~/components/layout/ExternalLink";
import { InfoBox } from "~/components/InfoBox";
import { FeesModal } from "~/components/MoreInfoModal";
import { IntegratedQr } from "~/components/IntegratedQR";
import side2side from "~/assets/icons/side-to-side.svg";
import { useI18n } from "~/i18n/context";
import eify from "~/utils/eify";
import { matchError } from "~/logic/errorDispatch";

type OnChainTx = {
    transaction: {
        version: number;
        lock_time: number;
        input: Array<{
            previous_output: string;
            script_sig: string;
            sequence: number;
            witness: Array<string>;
        }>;
        output: Array<{
            value: number;
            script_pubkey: string;
        }>;
    };
    txid: string;
    received: number;
    sent: number;
    confirmation_time: {
        height: number;
        timestamp: number;
    };
};

const RECEIVE_FLAVORS = [
    {
        value: "unified",
        label: "Unified",
        caption:
            "Combines a bitcoin address and a lightning invoice. Sender chooses payment method."
    },
    {
        value: "lightning",
        label: "Lightning invoice",
        caption:
            "Ideal for small transactions. Usually lower fees than on-chain."
    },
    {
        value: "onchain",
        label: "Bitcoin address",
        caption:
            "On-chain, just like Satoshi did it. Ideal for very large transactions."
    }
];

export type ReceiveFlavor = "unified" | "lightning" | "onchain";
type ReceiveState = "edit" | "show" | "paid";
type PaidState = "lightning_paid" | "onchain_paid";

function FeeWarning(props: { fee: bigint; flavor: ReceiveFlavor }) {
    return (
        // TODO: probably won't always be fixed 2500?
        <Show when={props.fee > 1000n}>
            <Switch>
                <Match when={props.flavor === "unified"}>
                    <InfoBox accent="blue">
                        A lightning setup fee of{" "}
                        <AmountSmall amountSats={props.fee} /> will be charged
                        if paid over lightning. <FeesModal />
                    </InfoBox>
                </Match>
                <Match when={props.flavor === "lightning"}>
                    <InfoBox accent="blue">
                        A lightning setup fee of{" "}
                        <AmountSmall amountSats={props.fee} /> will be charged
                        for this receive. <FeesModal />
                    </InfoBox>
                </Match>
            </Switch>
        </Show>
    );
}

function FeeExplanation(props: { fee: bigint }) {
    return (
        // TODO: probably won't always be a fixed 2500?
        <Switch>
            <Match when={props.fee > 1000n}>
                <InfoBox accent="blue">
                    A lightning setup fee of{" "}
                    <AmountSmall amountSats={props.fee} /> was charged for this
                    receive. <FeesModal />
                </InfoBox>
            </Match>
            <Match when={props.fee > 0n}>
                <InfoBox accent="blue">
                    A lightning service fee of{" "}
                    <AmountSmall amountSats={props.fee} /> was charged for this
                    receive. <FeesModal />
                </InfoBox>
            </Match>
        </Switch>
    );
}

export default function Receive() {
    const [state, _actions] = useMegaStore();
    const navigate = useNavigate();
    const i18n = useI18n();

    const [amount, setAmount] = createSignal("");
    const [receiveState, setReceiveState] = createSignal<ReceiveState>("edit");
    const [bip21Raw, setBip21Raw] = createSignal<MutinyBip21RawMaterials>();
    const [unified, setUnified] = createSignal("");
    const [shouldShowAmountEditor, setShouldShowAmountEditor] =
        createSignal(true);

    const [lspFee, setLspFee] = createSignal(0n);

    // Tagging stuff
    const [selectedValues, setSelectedValues] = createSignal<MutinyTagItem[]>(
        []
    );

    // The data we get after a payment
    const [paymentTx, setPaymentTx] = createSignal<OnChainTx>();
    const [paymentInvoice, setPaymentInvoice] = createSignal<MutinyInvoice>();

    // The flavor of the receive
    const [flavor, setFlavor] = createSignal<ReceiveFlavor>("unified");

    // loading state for the continue button
    const [loading, setLoading] = createSignal(false);

    const receiveString = createMemo(() => {
        if (unified() && receiveState() === "show") {
            if (flavor() === "unified") {
                return unified();
            } else if (flavor() === "lightning") {
                return bip21Raw()?.invoice ?? "";
            } else if (flavor() === "onchain") {
                return bip21Raw()?.address ?? "";
            }
        }
    });

    function clearAll() {
        setAmount("");
        setReceiveState("edit");
        setBip21Raw(undefined);
        setUnified("");
        setPaymentTx(undefined);
        setPaymentInvoice(undefined);
        setSelectedValues([]);
    }

    async function processContacts(
        contacts: Partial<MutinyTagItem>[]
    ): Promise<string[]> {
        if (contacts.length) {
            const first = contacts![0];

            if (!first.name) {
                return [];
            }

            if (!first.id && first.name) {
                const c = new Contact(
                    first.name,
                    undefined,
                    undefined,
                    undefined
                );
                try {
                    const newContactId =
                        await state.mutiny_wallet?.create_new_contact(c);
                    if (newContactId) {
                        return [newContactId];
                    }
                } catch (e) {
                    console.error(e);
                }
            }

            if (first.id) {
                return [first.id];
            }
        }

        return [];
    }

    async function getUnifiedQr(amount: string) {
        const bigAmount = BigInt(amount);
        setLoading(true);

        // Both paths use tags so we'll do this once
        let tags;

        try {
            tags = await processContacts(selectedValues());
        } catch (e) {
            showToast(eify(e));
            console.error(e);
            setLoading(false);
            return;
        }

        // Happy path
        // First we try to get both an invoice and an address
        try {
            const raw = await state.mutiny_wallet?.create_bip21(
                bigAmount,
                tags
            );
            // Save the raw info so we can watch the address and invoice
            setBip21Raw(raw);

            const params = objectToSearchParams({
                amount: raw?.btc_amount,
                lightning: raw?.invoice
            });

            setLoading(false);
            return `bitcoin:${raw?.address}?${params}`;
        } catch (e) {
            showToast(matchError(e));
            console.error(e);
        }

        // If we didn't return before this, that means create_bip21 failed
        // So now we'll just try and get an address without the invoice
        try {
            const raw = await state.mutiny_wallet?.get_new_address(tags);

            // Save the raw info so we can watch the address
            setBip21Raw(raw);

            setFlavor("onchain");

            // We won't meddle with a "unified" QR here
            return raw?.address;
        } catch (e) {
            // If THAT failed we're really screwed
            showToast(matchError(e));
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function onSubmit(e: Event) {
        e.preventDefault();

        const unifiedQr = await getUnifiedQr(amount());

        setUnified(unifiedQr || "");
        setReceiveState("show");
        setShouldShowAmountEditor(false);
    }

    async function checkIfPaid(
        bip21?: MutinyBip21RawMaterials
    ): Promise<PaidState | undefined> {
        if (bip21) {
            console.debug("checking if paid...");
            const lightning = bip21.invoice;
            const address = bip21.address;

            try {
                // Lightning invoice might be blank
                if (lightning) {
                    const invoice = await state.mutiny_wallet?.get_invoice(
                        lightning
                    );

                    // If the invoice has a fees amount that's probably the LSP fee
                    if (invoice?.fees_paid) {
                        setLspFee(invoice.fees_paid);
                    }

                    if (invoice && invoice.paid) {
                        setReceiveState("paid");
                        setPaymentInvoice(invoice);
                        return "lightning_paid";
                    }
                }

                const tx = (await state.mutiny_wallet?.check_address(
                    address
                )) as OnChainTx | undefined;

                if (tx) {
                    setReceiveState("paid");
                    setPaymentTx(tx);
                    return "onchain_paid";
                }
            } catch (e) {
                console.error(e);
            }
        }
    }

    const [paidState, { refetch }] = createResource(bip21Raw, checkIfPaid);

    const network = state.mutiny_wallet?.get_network() as Network;

    createEffect(() => {
        const interval = setInterval(() => {
            if (receiveState() === "show") refetch();
        }, 1000); // Poll every second
        onCleanup(() => {
            clearInterval(interval);
        });
    });

    const [methodChooserOpen, setMethodChooserOpen] = createSignal(false);

    return (
        <MutinyWalletGuard>
            <SafeArea>
                <DefaultMain>
                    <Show
                        when={receiveState() === "show"}
                        fallback={<BackLink />}
                    >
                        <BackButton
                            onClick={() => setReceiveState("edit")}
                            title="Edit"
                            showOnDesktop
                        />
                    </Show>
                    <LargeHeader
                        action={
                            receiveState() === "show" && (
                                <Indicator>Checking</Indicator>
                            )
                        }
                    >
                        {i18n.t("receive_bitcoin")}
                    </LargeHeader>
                    <Switch>
                        <Match when={!unified() || receiveState() === "edit"}>
                            <div class="flex flex-col flex-1 gap-8">
                                <AmountCard
                                    initialOpen={shouldShowAmountEditor()}
                                    amountSats={amount() || "0"}
                                    setAmountSats={setAmount}
                                    isAmountEditable
                                    exitRoute={amount() ? "/receive" : "/"}
                                />

                                <Card title={i18n.t("private_tags")}>
                                    <TagEditor
                                        selectedValues={selectedValues()}
                                        setSelectedValues={setSelectedValues}
                                        placeholder={i18n.t(
                                            "receive_add_the_sender"
                                        )}
                                    />
                                </Card>

                                <div class="flex-1" />
                                <Button
                                    class="w-full flex-grow-0"
                                    disabled={!amount()}
                                    intent="green"
                                    onClick={onSubmit}
                                    loading={loading()}
                                >
                                    {i18n.t("continue")}
                                </Button>
                            </div>
                        </Match>
                        <Match when={unified() && receiveState() === "show"}>
                            <FeeWarning fee={lspFee()} flavor={flavor()} />
                            <IntegratedQr
                                value={receiveString() ?? ""}
                                amountSats={amount() || "0"}
                                kind={flavor()}
                            />
                            <p class="text-neutral-400 text-center">
                                {i18n.t("keep_mutiny_open")}
                            </p>
                            {/* Only show method chooser when we have an invoice */}
                            <Show when={bip21Raw()?.invoice}>
                                <button
                                    class="font-bold text-m-grey-400 flex gap-2 p-2 items-center mx-auto"
                                    onClick={() => setMethodChooserOpen(true)}
                                >
                                    <span>Choose format</span>
                                    <img class="w-4 h-4" src={side2side} />
                                </button>
                                <SimpleDialog
                                    title="Choose payment format"
                                    open={methodChooserOpen()}
                                    setOpen={(open) =>
                                        setMethodChooserOpen(open)
                                    }
                                >
                                    <StyledRadioGroup
                                        value={flavor()}
                                        onValueChange={setFlavor}
                                        choices={RECEIVE_FLAVORS}
                                        accent="white"
                                        vertical
                                    />
                                </SimpleDialog>
                            </Show>
                        </Match>
                        <Match
                            when={
                                receiveState() === "paid" &&
                                paidState() === "lightning_paid"
                            }
                        >
                            <SuccessModal
                                title="Payment Received"
                                open={!!paidState()}
                                setOpen={(open: boolean) => {
                                    if (!open) clearAll();
                                }}
                                onConfirm={() => {
                                    clearAll();
                                    navigate("/");
                                }}
                            >
                                <MegaCheck />
                                <FeeExplanation fee={lspFee()} />
                                <Amount
                                    amountSats={paymentInvoice()?.amount_sats}
                                    showFiat
                                    centered
                                />
                            </SuccessModal>
                        </Match>
                        <Match
                            when={
                                receiveState() === "paid" &&
                                paidState() === "onchain_paid"
                            }
                        >
                            <SuccessModal
                                title="Payment Received"
                                open={!!paidState()}
                                setOpen={(open: boolean) => {
                                    if (!open) clearAll();
                                }}
                                onConfirm={() => {
                                    clearAll();
                                    navigate("/");
                                }}
                            >
                                <MegaCheck />
                                <Amount
                                    amountSats={paymentTx()?.received}
                                    showFiat
                                    centered
                                />
                                <ExternalLink
                                    href={mempoolTxUrl(
                                        paymentTx()?.txid,
                                        network
                                    )}
                                >
                                    View Transaction
                                </ExternalLink>
                            </SuccessModal>
                        </Match>
                    </Switch>
                </DefaultMain>
                <NavBar activeTab="receive" />
            </SafeArea>
        </MutinyWalletGuard>
    );
}
