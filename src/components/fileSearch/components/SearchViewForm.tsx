import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
  } from "@/components/ui/accordion";
  import { Input } from "@/components/ui/input";
  import { FsSearchQuery } from "@/lib/generated";
  import {
    ArrowLeftRight,
    CaseSensitive,
    Regex,
    Settings2,
    WholeWord,
  } from "lucide-react";
  import { Controller, useForm } from "react-hook-form";
  
  interface Props {
    onSubmit: (query: FsSearchQuery) => void;
  }
  
  export default function SearchViewForm({ onSubmit }: Props) {
    const {
      control,
      register,
      handleSubmit,
    } = useForm<FsSearchQuery & { replace: string }>({
      defaultValues: {
        search: "",
        replace: "",
        include: "",
        exclude: "",
        match_case: false,
        match_whole_word: false,
        regex: false,
      },
    });
  
    return (
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Search / Replace accordion */}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
        <Accordion
          type="single"
          collapsible
          defaultValue="replace"
          className="px-3 border-b-0"
        >
          <AccordionItem value="replace" className="border-b-0">
            <AccordionTrigger header="">
              <div className="flex-1 relative">
                <input
                  {...register("search")}
                //   rows={2}
                  className="w-full resize-none border outline-none rounded-[3px] px-2 py-1 pr-20 text-[13px] leading-5"
                />
  
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
                  <Controller
                    name="match_case"
                    control={control}
                    render={({ field }) => (
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`h-6 w-6 flex items-center justify-center rounded hover:bg-[#3c3c3c] ${
                          field.value ? "bg-[#3c3c3c] text-white" : ""
                        }`}
                        aria-pressed={field.value}
                        title="Match Case"
                      >
                        <CaseSensitive className="h-4 w-4" />
                      </button>
                    )}
                  />
  
                  <Controller
                    name="match_whole_word"
                    control={control}
                    render={({ field }) => (
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`h-6 w-6 flex items-center justify-center rounded hover:bg-[#3c3c3c] ${
                          field.value ? "bg-[#3c3c3c] text-white" : ""
                        }`}
                        aria-pressed={field.value}
                        title="Match Whole Word"
                      >
                        <WholeWord className="h-4 w-4" />
                      </button>
                    )}
                  />
  
                  <Controller
                    name="regex"
                    control={control}
                    render={({ field }) => (
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`h-6 w-6 flex items-center justify-center rounded hover:bg-[#3c3c3c] ${
                          field.value ? "bg-[#3c3c3c] text-white" : ""
                        }`}
                        aria-pressed={field.value}
                        title="Use Regular Expression"
                      >
                        <Regex className="h-4 w-4" />
                      </button>
                    )}
                  />
                </div>
              </div>
            </AccordionTrigger>
  
            <AccordionContent className="pl-4 pt-1.5 pb-0">
              <div className="relative">
                <Input
                  {...register("replace")}
                  placeholder="Replace"
                  className="w-full h-7 border outline-none rounded-[3px] px-2 pr-14 text-[13px] placeholder:text-[#7a7a7a]"
                />
  
                <div className="absolute right-1.5 top-1 flex items-center gap-0.5">
                  <span className="text-[11px] px-0.5 tracking-wide">
                    AB
                  </span>
  
                  <button
                    type="button"
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-[#3c3c3c]"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
  
        {/* Files to include */}
        <div className="px-3 mt-3">
          <div className="flex items-center justify-between mb-1">
            <span>files to include</span>
  
            <button
              type="button"
              className="hover:text-white text-[13px] leading-none px-1"
            >
              •••
            </button>
          </div>
  
          <Input
            {...register("include")}
            placeholder=""
            className="h-7 focus-visible:ring-0 focus-visible:border-[#007fd4] rounded-[3px] text-[13px]"
          />
        </div>
  
        {/* Files to exclude */}
        <div className="px-3 mt-3">
          <span className="mb-1 block">files to exclude</span>
  
          <div className="relative">
            <Input
              {...register("exclude")}
              placeholder=""
              className="h-7 focus-visible:ring-0 focus-visible:border-[#007fd4] rounded-[3px] text-[13px] pr-8"
            />
  
            <button
              type="button"
              className="absolute right-1 top-1 h-5 w-5 flex items-center justify-center rounded hover:bg-[#3c3c3c]"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
  
        <button type="submit" className="hidden">
          Search
        </button>
      </form>
    );
  }