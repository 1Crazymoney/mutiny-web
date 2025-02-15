import { For, Match, Switch, createMemo, createSignal } from "solid-js";
import { useCopy } from "~/utils/useCopy";
import copyIcon from "~/assets/icons/copy.svg";

export function SeedWords(props: {
    words: string;
    setHasSeen?: (hasSeen: boolean) => void;
}) {
    const [shouldShow, setShouldShow] = createSignal(false);
    const [copy, copied] = useCopy({ copiedTimeout: 1000 });

    function toggleShow() {
        setShouldShow(!shouldShow());
        if (shouldShow()) {
            props.setHasSeen?.(true);
        }
    }

    const splitWords = createMemo(() => props.words.split(" "));

    function dangerouslyCopy() {
        copy(props.words);
    }

    return (
        <div class="flex flex-col gap-4 bg-m-red p-4 rounded-xl overflow-hidden">
            <Switch>
                <Match when={!shouldShow()}>
                    <div
                        class="cursor-pointer flex w-full justify-center"
                        onClick={toggleShow}
                    >
                        <code class="text-red">TAP TO REVEAL SEED WORDS</code>
                    </div>
                </Match>

                <Match when={shouldShow()}>
                    <>
                        <div
                            class="cursor-pointer flex w-full justify-center"
                            onClick={toggleShow}
                        >
                            <code class="text-red">HIDE</code>
                        </div>
                        <ol class="overflow-hidden columns-2 w-full list-decimal list-inside">
                            <For each={splitWords()}>
                                {(word) => (
                                    <li class="font-mono text-left min-w-fit bg">
                                        {word}
                                    </li>
                                )}
                            </For>
                        </ol>
                        <div class="flex w-full justify-center">
                            <button
                                onClick={dangerouslyCopy}
                                class="bg-white/10 hover:bg-white/20 p-2 rounded-lg"
                            >
                                <div class="flex items-center gap-2">
                                    <span>
                                        {copied()
                                            ? "Copied!"
                                            : "Dangerously Copy to Clipboard"}
                                    </span>
                                    <img
                                        src={copyIcon}
                                        alt="copy"
                                        class="w-4 h-4"
                                    />
                                </div>
                            </button>
                        </div>
                    </>
                </Match>
            </Switch>
        </div>
    );
}
