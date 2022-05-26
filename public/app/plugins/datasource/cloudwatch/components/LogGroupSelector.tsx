import { debounce, intersection, unionBy } from 'lodash';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { SelectableValue } from '@grafana/data';
import { MultiSelect } from '@grafana/ui';
import { InputActionMeta } from '@grafana/ui/src/components/Select/types';
import { notifyApp } from 'app/core/actions';
import { createErrorNotification } from 'app/core/copy/appNotification';
import { dispatch } from 'app/store/store';

import { CloudWatchDatasource } from '../datasource';
import { toOption } from '../utils/utils';

const MAX_LOG_GROUPS = 20;
const MAX_VISIBLE_LOG_GROUPS = 4;
const DEBOUNCE_TIMER = 300;

export interface LogGroupSelectorProps {
  region: string;
  selectedLogGroups: string[];
  onChange: (logGroups: string[]) => void;

  datasource?: CloudWatchDatasource;
  allowCustomValue?: boolean;
  onRunQuery?: () => void;
  onOpenMenu?: () => Promise<void>;
  refId?: string;
  width?: number | 'auto';
  saved?: boolean;
}

export const LogGroupSelector: React.FC<LogGroupSelectorProps> = ({
  region,
  selectedLogGroups,
  onChange,
  datasource,
  allowCustomValue,
  onRunQuery,
  onOpenMenu,
  refId,
  width,
  saved = true,
}) => {
  const [invalid, setInvalid] = useState(false);
  const [loadingLogGroups, setLoadingLogGroups] = useState(false);
  const [availableLogGroups, setAvailableLogGroups] = useState<Array<SelectableValue<string>>>([]);
  const logGroupOptions = useMemo(
    () => unionBy(availableLogGroups, selectedLogGroups?.map(toOption), 'value'),
    [availableLogGroups, selectedLogGroups]
  );

  const fetchLogGroupOptions = useCallback(
    async (region: string, logGroupNamePrefix?: string) => {
      if (!datasource) {
        return [];
      }
      try {
        const logGroups: string[] = await datasource.describeLogGroups({
          refId,
          region,
          logGroupNamePrefix,
        });
        return logGroups.map(toOption);
      } catch (err) {
        let errMessage = 'unknown error';
        if (typeof err !== 'string') {
          try {
            errMessage = JSON.stringify(err);
          } catch (e) {}
        } else {
          errMessage = err;
        }
        dispatch(notifyApp(createErrorNotification(errMessage)));
        return [];
      }
    },
    [datasource, refId]
  );

  const onLogGroupSearch = async (searchTerm: string, region: string, actionMeta: InputActionMeta) => {
    if (actionMeta.action !== 'input-change') {
      return Promise.resolve();
    }
    if (!datasource) {
      return Promise.resolve();
    }

    // No need to fetch matching log groups if the search term isn't valid
    // This is also useful for preventing searches when a user is typing out a log group with template vars
    // See https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_LogGroup.html for the source of the pattern below
    const logGroupNamePattern = /^[\.\-_/#A-Za-z0-9]+$/;
    if (!logGroupNamePattern.test(searchTerm)) {
      return Promise.resolve();
    }

    setLoadingLogGroups(true);
    try {
      const matchingLogGroups = await fetchLogGroupOptions(region, searchTerm);
      setAvailableLogGroups(unionBy(availableLogGroups, matchingLogGroups, 'value'));
    } finally {
      setLoadingLogGroups(false);
    }
  };

  useEffect(() => {
    async function resetLogGroups() {
      // Don't call describeLogGroups if datasource or region is undefined
      if (!datasource || !datasource.getActualRegion(region)) {
        setAvailableLogGroups([]);
        return;
      }

      setLoadingLogGroups(true);
      return fetchLogGroupOptions(datasource.getActualRegion(region))
        .then((logGroups) => {
          const newSelectedLogGroups = intersection(
            selectedLogGroups,
            logGroups.map(({ value }) => value)
          );
          onChange(newSelectedLogGroups);
          setAvailableLogGroups(logGroups);
        })
        .finally(() => {
          setLoadingLogGroups(false);
        });
    }
    // Only reset if the current datasource is saved
    saved && resetLogGroups();
    // this hook shouldn't get called every time selectedLogGroups or onChange updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasource, fetchLogGroupOptions, region, saved]);

  const onOpenLogGroupMenu = async () => {
    if (onOpenMenu) {
      await onOpenMenu();
    }
    setInvalid(false);
  };

  const onLogGroupSearchDebounced = debounce(onLogGroupSearch, DEBOUNCE_TIMER);

  return (
    <MultiSelect
      inputId="default-log-groups"
      aria-label="Log Groups"
      allowCustomValue={allowCustomValue}
      options={logGroupOptions}
      value={selectedLogGroups}
      onChange={(v) => onChange(v.map(({ value }) => value!))}
      onBlur={onRunQuery}
      closeMenuOnSelect={false}
      isClearable
      invalid={invalid}
      isOptionDisabled={() => selectedLogGroups.length >= MAX_LOG_GROUPS}
      placeholder="Choose Log Groups"
      maxVisibleValues={MAX_VISIBLE_LOG_GROUPS}
      noOptionsMessage="No log groups available"
      isLoading={loadingLogGroups}
      onOpenMenu={onOpenLogGroupMenu}
      onInputChange={(value, actionMeta) => {
        onLogGroupSearchDebounced(value, region, actionMeta);
      }}
      width={width}
    />
  );
};