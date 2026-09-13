import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useGitFeature } from "./GitFeatureProvider";
import { GitChangeView } from "./models/git-view.model";
import GitChangeList from "./GitChangeList";
import GitChangeTree from "./GitChangeTree";

interface Props {
  title: string;
  view: GitChangeView;
}

export default function GitChangeGroup(props: Props) {
  const { staged, unstaged, mode, pending, mutate } = useGitFeature();
  const changes = props.view === "staged" ? staged : unstaged;
  if (!changes.length) return null;
  return (
    <Accordion type="single" collapsible defaultValue={props.view} className="border-t border-border/50">
      <AccordionItem value={props.view} className="border-0">
        <AccordionTrigger
          className="py-1.5 pl-2 text-xs uppercase tracking-wide hover:no-underline"
          header={
            <span>
              {props.title} <span className="text-muted-foreground">{changes.length}</span>
            </span>
          }>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="mr-2 h-6 px-1.5 text-[11px] text-muted-foreground"
            onClick={() => mutate(props.view, changes)}>
            {props.view === "staged" ? "Unstage all" : "Stage all"}
          </Button>
        </AccordionTrigger>
        <AccordionContent className="pb-0">
          {mode === "tree" ? (
            <GitChangeTree changes={changes} view={props.view} />
          ) : (
            <GitChangeList changes={changes} view={props.view} />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
