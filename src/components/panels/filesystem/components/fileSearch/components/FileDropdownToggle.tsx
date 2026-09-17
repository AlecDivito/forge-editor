import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
    expanded: boolean
}

export default function FileDropdownToggle({ expanded }: Props) {
    return expanded ? (<ChevronDown className="h-4 w-4 shrink-0" />) : (<ChevronRight className="h-4 w-4 shrink-0" />)
}