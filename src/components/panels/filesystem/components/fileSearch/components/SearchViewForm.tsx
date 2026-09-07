import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { FsSearchQuery, FsSearchResponse } from "@/lib/generated";
import {
    ArrowLeftRight,
    CaseSensitive,
    Regex,
    Settings2,
    WholeWord,
} from "lucide-react";
import { ReactNode, useCallback, useRef, useState } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { ReplaceAlertDialog } from "./ReplaceAlertDialog";

interface Props {
    onSubmit: (query: FsSearchQuery) => void;
    onReplace: (query: FsSearchQuery) => void;
    results?: FsSearchResponse
    children: ReactNode
}

type FormValues = FsSearchQuery & {
    replace: string;
    preserve_case: boolean;
};

export default function SearchViewForm({ children, results, onSubmit, onReplace }: Props) {
    const [hideOptions, setHideOptions] = useState(false);
    const method = useForm<FormValues>({
        defaultValues: {
            search: "",
            replace: "",
            include: "",
            exclude: "",
            match_case: false,
            match_whole_word: false,
            regex: false,
            preserve_case: false,
        },
    });
    const {
        control,
        register,
        handleSubmit,
        getValues,
        setValue,
        watch,
    } = method

    const replaceValue = watch('replace')

    const hiddenOptions = useRef({
        include: "",
        exclude: "",
    });

    const toggleHideOptions = useCallback(() => {
        setHideOptions((hidden) => {
            if (!hidden) {
                const values = getValues();

                hiddenOptions.current = {
                    include: values.include || "",
                    exclude: values.exclude || "",
                };

                setValue("include", "");
                setValue("exclude", "");

                return true;
            }

            setValue("include", hiddenOptions.current.include);
            setValue("exclude", hiddenOptions.current.exclude);

            return false;
        });
    }, [getValues, setValue]);

    const submitReplace = () => {
        handleSubmit(onReplace)();
    };

    return (
        <FormProvider {...method}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
                <button type="submit" className="hidden" aria-hidden='true' />
                <Accordion type="single" collapsible className="px-3">
                    <AccordionItem value="replace" className="border-b-0">
                        <AccordionTrigger className="py-0 hover:no-underline">
                            <div className="relative flex-1 pl-2 pr-0.5">
                                <Input
                                    {...register("search")}
                                    className="h-8 pr-20 text-sm"
                                />

                                <div className="absolute right-1 top-1 flex items-center gap-0.5">
                                    <Controller
                                        name="match_case"
                                        control={control}
                                        render={({ field }) => (
                                            <HoverCard openDelay={200}>
                                                <HoverCardTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            field.onChange(
                                                                !field.value,
                                                            )
                                                        }
                                                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${field.value
                                                            ? "bg-accent text-accent-foreground"
                                                            : "text-muted-foreground"
                                                            }`}
                                                        aria-pressed={field.value}
                                                    >
                                                        <CaseSensitive className="h-4 w-4" />
                                                    </button>
                                                </HoverCardTrigger>

                                                <HoverCardContent
                                                    side="bottom"
                                                    align="end"
                                                    className="w-auto px-3 py-2 text-xs"
                                                >
                                                    Match Case
                                                </HoverCardContent>
                                            </HoverCard>
                                        )}
                                    />

                                    <Controller
                                        name="match_whole_word"
                                        control={control}
                                        render={({ field }) => (
                                            <HoverCard openDelay={200}>
                                                <HoverCardTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            field.onChange(
                                                                !field.value,
                                                            )
                                                        }
                                                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${field.value
                                                            ? "bg-accent text-accent-foreground"
                                                            : "text-muted-foreground"
                                                            }`}
                                                        aria-pressed={field.value}
                                                    >
                                                        <WholeWord className="h-4 w-4" />
                                                    </button>
                                                </HoverCardTrigger>

                                                <HoverCardContent
                                                    side="bottom"
                                                    align="end"
                                                    className="w-auto px-3 py-2 text-xs"
                                                >
                                                    Match Whole Word
                                                </HoverCardContent>
                                            </HoverCard>
                                        )}
                                    />

                                    <Controller
                                        name="regex"
                                        control={control}
                                        render={({ field }) => (
                                            <HoverCard openDelay={200}>
                                                <HoverCardTrigger asChild>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            field.onChange(
                                                                !field.value,
                                                            )
                                                        }
                                                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${field.value
                                                            ? "bg-accent text-accent-foreground"
                                                            : "text-muted-foreground"
                                                            }`}
                                                        aria-pressed={field.value}
                                                    >
                                                        <Regex className="h-4 w-4" />
                                                    </button>
                                                </HoverCardTrigger>

                                                <HoverCardContent
                                                    side="bottom"
                                                    align="end"
                                                    className="w-auto px-3 py-2 text-xs"
                                                >
                                                    Use Regular Expression
                                                </HoverCardContent>
                                            </HoverCard>
                                        )}
                                    />
                                </div>
                            </div>
                        </AccordionTrigger>

                        <AccordionContent className="pl-6 pt-2 pb-0.5 pr-0.5">
                            <div className="flex items-center w-full gap-1">
                                <div className="relative w-full">

                                    <Input
                                        {...register("replace")}
                                        placeholder="Replace"
                                        className="h-8 flex-1 text-sm"
                                    />
                                    <div className="absolute right-1 top-1 flex items-center gap-0.5">
                                        <Controller
                                            name="preserve_case"
                                            control={control}
                                            render={({ field }) => (
                                                <HoverCard openDelay={200}>
                                                    <HoverCardTrigger asChild>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                field.onChange(
                                                                    !field.value,
                                                                )
                                                            }
                                                            className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground ${field.value
                                                                ? "bg-accent text-accent-foreground"
                                                                : "text-muted-foreground"
                                                                }`}
                                                            aria-pressed={field.value}
                                                            aria-label="Preserve Case"
                                                        >
                                                            AB
                                                        </button>
                                                    </HoverCardTrigger>

                                                    <HoverCardContent
                                                        side="bottom"
                                                        align="end"
                                                        className="w-auto px-3 py-2 text-xs"
                                                    >
                                                        Preserve Case
                                                    </HoverCardContent>
                                                </HoverCard>
                                            )}
                                        />
                                    </div>
                                </div>

                                <ReplaceAlertDialog results={results} onSubmit={submitReplace} replacement={replaceValue} />
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>

                {!hideOptions && (
                    <>
                        <div className="px-3">
                            <div className="flex items-center justify-between">
                                <label
                                    htmlFor="files-to-include"
                                    className="text-sm font-medium"
                                >
                                    Files to include
                                </label>

                                <button
                                    type="button"
                                    onClick={toggleHideOptions}
                                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                    aria-label="Hide file options"
                                    aria-pressed={hideOptions}
                                    title="Hide file options"
                                >
                                    •••
                                </button>
                            </div>

                            <Input
                                id="files-to-include"
                                {...register("include")}
                                className="h-8 text-sm"
                            />
                        </div>

                        <div className="px-3">
                            <label
                                htmlFor="files-to-exclude"
                                className="mb-1 block text-sm font-medium"
                            >
                                Files to exclude
                            </label>

                            <div className="relative">
                                <Input
                                    id="files-to-exclude"
                                    {...register("exclude")}
                                    className="h-8 pr-9 text-sm"
                                />

                                <button
                                    type="button"
                                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                    aria-label="Exclude file options"
                                >
                                    <Settings2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {hideOptions && (
                    <div className="flex w-full justify-end px-3">
                        <button
                            type="button"
                            onClick={toggleHideOptions}
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            aria-label="Show file options"
                            aria-pressed={hideOptions}
                            title="Show file options"
                        >
                            •••
                        </button>
                    </div>
                )}

                <button type="submit" className="hidden">
                    Search
                </button>
            </form>
            {children}
        </FormProvider>
    );
}
