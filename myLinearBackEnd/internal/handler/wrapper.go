package handler

import "encoding/json"

type Nullable[T any] struct {
	Set   bool //JSON中是否设置
	Valid bool //是否是有效值 不是null
	Value T
}

func (n *Nullable[T]) UnmarshalJSON(data []byte) error {
	/*
		此方法被调用即证明字段出现，字段直接没传的话，UnmarshalJSON不会被调用，set 保持 false -> 置空
		data不是“字符串类型的值，而是这个字段值的原始JSON字节”
	*/
	n.Set = true
	if string(data) == "null" {
		return nil //Valid 保持 false -> 置空
	}
	n.Valid = true
	return json.Unmarshal(data, &n.Value)
}

// ValuePtr 返回指向 Value 的指针：仅当 Set 且 Valid（非 null）时非 nil。
// 用于 PATCH presence 合并：`if req.X.Set { got.X = req.X.ValuePtr() }`
// —— 显式 null（Valid=false）时得 nil，即置空；指针指向副本，不共享请求结构体内部字段
func (n Nullable[T]) ValuePtr() *T {
	if !n.Set || !n.Valid {
		return nil
	}
	v := n.Value
	return &v
}

/*
请求体					 data 的内容						走向			结果
字段没传				（UnmarshalJSON 根本不会被调用）	 —				  Set=false
"memberIds": null		字节 null						   命中 == "null"	Set=true, Valid=false
"memberIds": []			字节 []							   不等于 "null"	Set=true, Valid=true, Value=空切片
"memberIds": ["x"]		字节 ["x"]						  不等于 "null"		Set=true, Valid=true
*/
